import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, emailOutbox, guestRequests, hotels, type Hotel } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { RequestError, createGuestRequest, listGuestRequests, openGuestRequestCount, requestsOfBooking, selfCheckout, setGuestRequestDone } from "../../src/services/guest-requests";
import { addPortalTip, deletePortalTip, savePortalSettings } from "../../src/services/portal-settings";
import { hotelKnowledge } from "../../src/services/knowledge";
import { addFolioItem } from "../../src/services/invoicing";
import { portalFolio } from "../../src/services/guest-portal";
import { MAX_OPEN_REQUESTS } from "../../src/domain/portal";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const fresh = async (id: string): Promise<Hotel> => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];

async function setup() {
  const h = await makeHotel();
  const hotel = await fresh(h.hotel.id);
  const checkin = inDays(1);
  const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: undefined } as never);
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  return { hotel, booking, checkin, checkout: addDays(checkin, 2) };
}

describe("Gästewünsche (SPEC 19.41)", () => {
  it("Wunsch aus Liste und freier Text: Mail, Push-Eintrag, Status, Erledigt", async () => {
    const { hotel, booking, checkin } = await setup();
    const r1 = await createGuestRequest(hotel, booking.id, { itemId: "late_checkout", message: "um 14 Uhr" }, checkin, "de");
    expect(r1).toMatchObject({ label: expect.stringContaining("Late Check-out"), status: "open", message: "um 14 Uhr" });
    await createGuestRequest(hotel, booking.id, { message: "Bitte ruhiges Zimmer" }, checkin, "de");
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "guest_request")));
    expect(mails).toHaveLength(2);
    expect(mails[0].toEmail).toBe(hotel.contactEmail);
    expect(await openGuestRequestCount(hotel.id)).toBe(2);
    expect(await setGuestRequestDone(hotel.id, r1.id, true, "rezeption", "Bis 14 Uhr ok")).toBe(true);
    const mine = await requestsOfBooking(hotel.id, booking.id);
    expect(mine.find((r) => r.id === r1.id)).toMatchObject({ status: "done", note: "Bis 14 Uhr ok", doneBy: "rezeption" });
    expect(await openGuestRequestCount(hotel.id)).toBe(1);
    const list = await listGuestRequests(hotel.id);
    expect(list[0].r.status).toBe("open"); // offene zuerst
    expect(list[0].reference).toBe(booking.reference);
  });

  it("leer, unbekannter Wunsch, deaktiviert, nach Abreise, unbestätigt", async () => {
    const { hotel, booking, checkin, checkout } = await setup();
    await expect(createGuestRequest(hotel, booking.id, {}, checkin, "de")).rejects.toMatchObject({ code: "empty" });
    await expect(createGuestRequest(hotel, booking.id, { itemId: "gibt_es_nicht" }, checkin, "de")).rejects.toMatchObject({ code: "unknown_wish" });
    await expect(createGuestRequest(hotel, booking.id, { message: "x" }, addDays(checkout, 1), "de")).rejects.toMatchObject({ code: "closed" });
    await db().update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    await expect(createGuestRequest(hotel, booking.id, { message: "x" }, checkin, "de")).rejects.toBeInstanceOf(RequestError);
    await db().update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, booking.id));
    await savePortalSettings(hotel, "t", { requests: false, doorCode: true, folio: true, selfCheckout: true, standardIds: [], custom: "" });
    await expect(createGuestRequest(await fresh(hotel.id), booking.id, { message: "x" }, checkin, "de")).rejects.toMatchObject({ code: "disabled" });
  });

  it("Grenze offener Wünsche pro Buchung, auch bei gleichzeitigen Absendungen", async () => {
    const { hotel, booking, checkin } = await setup();
    const res = await Promise.allSettled(Array.from({ length: MAX_OPEN_REQUESTS + 3 }, (_, i) => createGuestRequest(hotel, booking.id, { message: `w${i}` }, checkin, "de")));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(MAX_OPEN_REQUESTS);
    expect((await requestsOfBooking(hotel.id, booking.id))).toHaveLength(MAX_OPEN_REQUESTS);
  });

  it("Mandantentrennung: fremdes Hotel sieht und ändert nichts", async () => {
    const a = await setup();
    const b = await setup();
    const r = await createGuestRequest(a.hotel, a.booking.id, { message: "geheim" }, a.checkin, "de");
    expect(await listGuestRequests(b.hotel.id)).toHaveLength(0);
    expect(await requestsOfBooking(b.hotel.id, a.booking.id)).toHaveLength(0);
    expect(await setGuestRequestDone(b.hotel.id, r.id, true, "x")).toBe(false);
    await expect(createGuestRequest(b.hotel, a.booking.id, { message: "x" }, a.checkin, "de")).rejects.toMatchObject({ code: "closed" });
    expect((await db().select().from(guestRequests).where(eq(guestRequests.id, r.id)))[0].status).toBe("open");
  });
});

describe("Wunschliste, Tipps und KI-Chat", () => {
  it("eigene Wünsche und Tipps speichern; Chat-Wissen enthält dieselben Tipps in der Gastsprache", async () => {
    const { hotel } = await setup();
    await savePortalSettings(hotel, "t", { requests: true, doorCode: true, folio: true, selfCheckout: true, standardIds: ["towels"], custom: "Hund mitbringen | Bring a dog\nFrühstück früher" });
    let h = await fresh(hotel.id);
    expect(h.content.portal?.wishes?.map((w) => w.id)).toEqual(["towels", "c1", "c2"]);
    expect(h.content.portal?.wishes?.[1].label).toEqual({ de: "Hund mitbringen", en: "Bring a dog" });
    await addPortalTip(h, "t", { title: { de: "Wanderung zum See", en: "Hike to the lake" }, text: { de: "2 Stunden", en: "2 hours" } });
    h = await fresh(hotel.id);
    expect((await hotelKnowledge(h, "de")).stayTips).toEqual([{ title: "Wanderung zum See", text: "2 Stunden" }]);
    expect((await hotelKnowledge(h, "en")).stayTips[0].title).toBe("Hike to the lake");
    await expect(addPortalTip(h, "t", { title: {}, text: {} })).rejects.toThrow();
    await deletePortalTip(h, "t", h.content.portal!.tips![0].id);
    expect((await fresh(hotel.id)).content.portal?.tips).toEqual([]);
  });
});

describe("Rechnung bis jetzt und Selbst-Check-out", () => {
  it("Posten aufs Zimmer erscheinen nur während des Aufenthalts", async () => {
    const { hotel, booking } = await setup();
    await addFolioItem(hotel.id, booking.id, { description: "Abendessen", quantity: 2, unitPriceRappen: 4500, vatKind: "standard" }, "t");
    const b = (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
    expect(await portalFolio(hotel, b, new Date(Date.now() - 5 * 86400_000))).toBeNull(); // vor der Anreise
    const during = await portalFolio(hotel, b, new Date(`${b.checkin}T12:00:00Z`));
    expect(during?.items.map((i) => i.description)).toEqual(["Abendessen"]);
    expect(during?.folioRappen).toBe(9000);
    await savePortalSettings(hotel, "t", { requests: true, doorCode: true, folio: false, selfCheckout: true, standardIds: [], custom: "" });
    expect(await portalFolio(await fresh(hotel.id), b, new Date(`${b.checkin}T12:00:00Z`))).toBeNull();
  });

  it("Check-out nur am Abreisetag, einmal, mit Eintrag im Posteingang", async () => {
    const { hotel, booking, checkin, checkout } = await setup();
    await expect(selfCheckout(hotel, booking.id, checkin)).rejects.toMatchObject({ code: "closed" });
    expect(await selfCheckout(hotel, booking.id, checkout)).toBe("done");
    expect(await selfCheckout(hotel, booking.id, checkout)).toBe("already");
    const b = (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
    expect(b.guestCheckoutAt).not.toBeNull();
    expect(b.status).toBe("confirmed");
    const rs = (await requestsOfBooking(hotel.id, booking.id)).filter((r) => r.itemId === "checkout");
    expect(rs).toHaveLength(1);
  });
});
