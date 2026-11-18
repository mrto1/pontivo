import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, hotels, inquiries, resourceBookings } from "../../src/db/schema";
import { createInquiry } from "../../src/services/inquiries";
import { acceptOffer, createOfferFromInquiry, declineOffer, offerByToken, OfferError, saveOffer, sendOffer } from "../../src/services/offers";
import { createResourceBooking, listResources, saveResource } from "../../src/services/resources";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const room = { name: "Seminarraum", kind: "seminar" as const, capacity: 20, slotMinutes: 60, openFrom: "08:00", openTo: "18:00", priceRappen: 10_000, pricePerPerson: false, vatKind: "standard" as const };

async function setup() {
  const h = await makeHotel();
  const hotel = await fresh(h.hotel.id);
  const r = await saveResource(hotel.id, null, room, "t");
  const q = await createInquiry(hotel, { kind: "seminar", name: "Anna Muster", email: "anna@firma.ch", dateFrom: inDays(30), dateTo: null, persons: 12, timeOfDay: null, message: "Tagung", language: "de", pageSlug: "" });
  return { hotel, r, q };
}
const lines = (rid: string, day: string) => [
  { description: "Seminarraum ganzer Tag", quantity: 1, unitRappen: 0, vatKind: "standard" as const, resourceId: rid, day, start: "09:00", end: "17:00", persons: 12 },
  { description: "Kaffeepause", quantity: 12, unitRappen: 800, vatKind: "standard" as const, resourceId: null, day: null, start: null, end: null, persons: null },
];

describe("Angebote: Anfrage → Angebot → Annahme → Raumbuchung (SPEC 19.21)", () => {
  it("Ablauf mit Annahme legt die Raumreservation an, schliesst die Anfrage und mailt das Hotel", async () => {
    const { hotel, r, q } = await setup();
    const day = inDays(30);
    const o = await createOfferFromInquiry(hotel, q.id, "t");
    expect(o.seq).toBe(1);
    await expect(sendOffer(hotel, o.id, "t")).rejects.toBeInstanceOf(OfferError); // ohne Positionen
    await saveOffer(hotel, o.id, { title: "Tagung", intro: "Gerne", company: "Firma AG", validUntil: addDays(inDays(0), 10), lines: lines(r.id, day) }, "t");
    expect(await offerByToken(o.publicToken)).toBeNull(); // Entwurf nicht öffentlich
    await sendOffer(hotel, o.id, "t");
    await expect(saveOffer(hotel, o.id, { title: "x", validUntil: inDays(5), lines: [] }, "t")).rejects.toBeInstanceOf(OfferError);
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "offer_sent")));
    expect(mails).toHaveLength(1);
    const view = await offerByToken(o.publicToken);
    expect(view!.lines[0].unitRappen).toBe(80_000); // Preis des Raums übernommen (8 Zeitfenster à CHF 100)
    // vor Annahme: noch keine Reservation
    expect(await db().select().from(resourceBookings).where(eq(resourceBookings.hotelId, hotel.id))).toHaveLength(0);
    await acceptOffer(o.publicToken, "Danke");
    const rb = await db().select().from(resourceBookings).where(eq(resourceBookings.hotelId, hotel.id));
    expect(rb).toHaveLength(1);
    expect(rb[0]).toMatchObject({ day, startMin: 540, endMin: 1020, persons: 12, status: "confirmed" });
    expect((await db().select().from(inquiries).where(eq(inquiries.id, q.id)))[0].status).toBe("done");
    expect((await offerByToken(o.publicToken))!.offer.status).toBe("accepted");
    await expect(acceptOffer(o.publicToken, "")).rejects.toBeInstanceOf(OfferError); // nur einmal
    expect(await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "offer_accepted")))).toHaveLength(1);
  });

  it("Termin inzwischen belegt: Annahme scheitert, nichts bleibt reserviert, Angebot bleibt offen", async () => {
    const { hotel, r, q } = await setup();
    const day = inDays(31);
    const o = await createOfferFromInquiry(hotel, q.id, "t");
    await saveOffer(hotel, o.id, { title: "T", validUntil: inDays(10), lines: lines(r.id, day) }, "t");
    await sendOffer(hotel, o.id, "t");
    await createResourceBooking(hotel.id, { resourceId: r.id, day, start: "10:00", end: "11:00", persons: 2, guestName: "Anderer" }, "t");
    await expect(acceptOffer(o.publicToken, "")).rejects.toThrow(/nicht mehr frei/);
    expect((await db().select().from(resourceBookings).where(and(eq(resourceBookings.hotelId, hotel.id), eq(resourceBookings.status, "confirmed"))))).toHaveLength(1);
    expect((await offerByToken(o.publicToken))!.offer.status).toBe("sent");
  });

  it("abgelaufen und abgelehnt; Nummernkreis je Betrieb; Mandantentrennung", async () => {
    const a = await setup(), b = await setup();
    const o1 = await createOfferFromInquiry(a.hotel, a.q.id, "t");
    const o2 = await createOfferFromInquiry(a.hotel, a.q.id, "t");
    const ob = await createOfferFromInquiry(b.hotel, b.q.id, "t");
    expect([o1.seq, o2.seq, ob.seq]).toEqual([1, 2, 1]);
    await expect(createOfferFromInquiry(a.hotel, b.q.id, "t")).rejects.toBeInstanceOf(OfferError); // fremde Anfrage
    await expect(saveOffer(a.hotel, ob.id, { title: "x", validUntil: inDays(5), lines: [] }, "t")).rejects.toBeInstanceOf(OfferError); // fremdes Angebot
    await saveOffer(a.hotel, o1.id, { title: "T", validUntil: inDays(1), lines: [{ description: "x", quantity: 1, unitRappen: 100, vatKind: "none", resourceId: null, day: null, start: null, end: null, persons: null }] }, "t");
    await sendOffer(a.hotel, o1.id, "t");
    await expect(acceptOffer(o1.publicToken, "", new Date(Date.now() + 3 * 86_400_000))).rejects.toThrow(/nicht mehr gültig/);
    await declineOffer(o1.publicToken, "zu teuer");
    expect((await offerByToken(o1.publicToken))!.offer).toMatchObject({ status: "declined", decisionNote: "zu teuer" });
    expect(await listResources(b.hotel.id)).toHaveLength(1);
  });
});
