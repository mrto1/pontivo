import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { hotelMembers, hotelModules, pushOutbox, pushSubscriptions, users } from "../../src/db/schema";
import { enqueuePush, hasSubscription, savePushPrefs, removeSubscription, saveSubscription, sendDuePushes, setPushSender, type PushPayload, type PushTarget } from "../../src/push/service";
import { createDirectBooking, confirmBooking } from "../../src/services/bookings";
import { createInquiry } from "../../src/services/inquiries";
import { setPaymentProvider } from "../../src/payments/provider";
import { addDays } from "../../src/domain/dates";
import { cardStubs, guest, inDays, makeHotel, uid } from "../helpers";
import { hotels } from "../../src/db/schema";

afterAll(async () => {
  setPushSender(null);
  await closeDb();
});
// Andere Tests reihen ebenfalls Mitteilungen ein (jede Buchung): hier nur die eigenen zählen lassen
beforeEach(async () => {
  await db().update(pushOutbox).set({ status: "cancelled" }).where(eq(pushOutbox.status, "pending"));
});
afterEach(() => {
  setPushSender(null);
  setPaymentProvider(null);
});

const sub = (n: string) => ({ endpoint: `https://push.example.test/${n}`, keys: { p256dh: "p256-" + n, auth: "auth-" + n } });
async function makeUser() {
  const [u] = await db().insert(users).values({ email: `u-${uid()}@example.ch` }).returning();
  return u.id;
}
/** Mitglied eines Betriebs mit Rolle (Mitteilungen gehen nur an Mitglieder) */
async function member(hotelId: string, role = "owner") {
  const id = await makeUser();
  await db().insert(hotelMembers).values({ hotelId, userId: id, role });
  return id;
}
function recorder() {
  const sent: { target: PushTarget; payload: PushPayload }[] = [];
  setPushSender(async (target, payload) => void sent.push({ target, payload }));
  return sent;
}
const pending = (hotelId: string) => db().select().from(pushOutbox).where(eq(pushOutbox.hotelId, hotelId));

describe("Push-Mitteilungen", () => {
  it("einreihen: pro Ereignis nur einmal, Link nur auf /admin/", async () => {
    const h = await makeHotel();
    await enqueuePush(db(), h.hotel.id, "x:1", { title: "A", body: "b", url: `/admin/${h.hotel.id}/bookings` });
    await enqueuePush(db(), h.hotel.id, "x:1", { title: "A", body: "b", url: `/admin/${h.hotel.id}/bookings` });
    expect(await pending(h.hotel.id)).toHaveLength(1);
    await expect(enqueuePush(db(), h.hotel.id, "x:2", { title: "A", body: "b", url: "https://evil.example/" })).rejects.toThrow(/\/admin\//);
  });

  it("Geräte: nur https, pro Hotel und Gerät ein Eintrag, nur das eigene Gerät lässt sich abmelden", async () => {
    const h = await makeHotel();
    const u1 = await makeUser();
    const u2 = await makeUser();
    await expect(saveSubscription(h.hotel.id, u1, { endpoint: "http://insecure.test/x", keys: { p256dh: "a", auth: "b" } }, null)).rejects.toThrow(/Ungültig/);
    await saveSubscription(h.hotel.id, u1, sub("a"), "UA");
    await saveSubscription(h.hotel.id, u1, sub("a"), "UA2"); // gleiches Gerät: aktualisiert
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.hotelId, h.hotel.id))).toHaveLength(1);
    await removeSubscription(h.hotel.id, u2, sub("a").endpoint); // fremder Benutzer: ohne Wirkung
    expect(await hasSubscription(h.hotel.id, u1, sub("a").endpoint)).toBe(true);
    await removeSubscription(h.hotel.id, u1, sub("a").endpoint);
    expect(await hasSubscription(h.hotel.id, u1, sub("a").endpoint)).toBe(false);
  });

  it("senden: nur an Geräte des eigenen Hotels; abgemeldete Geräte (410) werden gelöscht", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const u = await member(a.hotel.id);
    await db().insert(hotelMembers).values({ hotelId: b.hotel.id, userId: u, role: "owner" });
    await saveSubscription(a.hotel.id, u, sub("a1"), null);
    await saveSubscription(a.hotel.id, u, sub("gone"), null);
    await saveSubscription(b.hotel.id, u, sub("b1"), null);
    await enqueuePush(db(), a.hotel.id, "t:1", { title: "Neue Buchung", body: "X", url: `/admin/${a.hotel.id}/bookings` });
    const sent: string[] = [];
    setPushSender(async (t) => {
      if (t.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push(t.endpoint);
    });
    const r = await sendDuePushes();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(sent).toContain(sub("a1").endpoint);
    expect(sent).not.toContain(sub("b1").endpoint);
    expect(await hasSubscription(a.hotel.id, u, sub("gone").endpoint)).toBe(false);
    expect((await pending(a.hotel.id))[0].status).toBe("sent");
  });

  it("ohne Geräte: Eintrag wird verworfen; bei vorübergehendem Fehler wird wiederholt, nach 3 Versuchen 'failed'", async () => {
    const h = await makeHotel();
    await enqueuePush(db(), h.hotel.id, "n:1", { title: "T", body: "b", url: `/admin/${h.hotel.id}` });
    recorder();
    await sendDuePushes();
    expect((await pending(h.hotel.id))[0].status).toBe("cancelled");

    const u = await member(h.hotel.id);
    await saveSubscription(h.hotel.id, u, sub("flaky"), null);
    await enqueuePush(db(), h.hotel.id, "n:2", { title: "T", body: "b", url: `/admin/${h.hotel.id}` });
    setPushSender(async () => {
      throw Object.assign(new Error("5xx"), { statusCode: 503 });
    });
    for (let i = 0; i < 3; i++) await sendDuePushes();
    const row = (await pending(h.hotel.id)).find((r) => r.dedupeKey === "n:2")!;
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    expect(await hasSubscription(h.hotel.id, u, sub("flaky").endpoint)).toBe(true); // bleibt bestehen
  });

  it("Ereignisse: neue Buchung und neue Anfrage lösen eine Mitteilung ohne Gästenamen aus", async () => {
    setPaymentProvider({
      name: "fake", confirmsImmediately: false, ...cardStubs,
      async createCheckout(a) { return { url: "https://checkout.test/" + a.booking.id, sessionId: "cs_" + a.booking.id }; },
      async createPaymentCheckout(a) { return { url: a.successUrl, sessionId: "cs_x" }; },
      async refund() { return { refundId: "re_1" }; },
    });
    const h = await makeHotel();
    const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    const d = inDays(30);
    const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    expect(await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" })).toBe("confirmed");
    const inq = await createInquiry(hotel, { kind: "group", name: "Geheim Gast", email: "g@example.ch", message: "Hallo", language: "de" });
    const rows = await pending(h.hotel.id);
    const booked = rows.find((r) => r.dedupeKey === `booking_new:${booking.id}`);
    expect(booked).toBeTruthy();
    expect(booked!.title).toBe("Neue Buchung");
    expect(booked!.body).toContain(booking.reference);
    expect(booked!.url).toBe(`/admin/${h.hotel.id}/bookings/${booking.id}`);
    expect(rows.find((r) => r.dedupeKey === `inquiry:${inq.id}`)).toMatchObject({ title: "Neue Anfrage", url: `/admin/${h.hotel.id}/inquiries` });
    for (const r of rows) expect(`${r.title} ${r.body}`).not.toMatch(/Erika|Geheim|@/);
  });
  it("Rollen und Einstellungen (SPEC 20.1): nur wer die Liste sieht und die Art nicht abgestellt hat; Nichtmitglieder nie", async () => {
    const h = await makeHotel();
    await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "restaurant", enabled: true });
    const owner = await member(h.hotel.id, "owner");
    const service = await member(h.hotel.id, "service");
    const cleaning = await member(h.hotel.id, "housekeeping");
    const stranger = await makeUser(); // Gerät ohne Mitgliedschaft
    for (const [n, u] of [["owner", owner], ["service", service], ["cleaning", cleaning], ["stranger", stranger]] as const) await saveSubscription(h.hotel.id, u, sub(n + h.hotel.id), null);
    const who = async (kind: "orders" | "bookings" | "other", key: string) => {
      await enqueuePush(db(), h.hotel.id, key, { title: "T", body: "b", url: `/admin/${h.hotel.id}`, kind });
      const sent: string[] = [];
      setPushSender(async (t) => void sent.push(t.endpoint.split("/").pop()!.replace(h.hotel.id, "")));
      await sendDuePushes();
      return sent.sort();
    };
    expect(await who("orders", "k:orders")).toEqual(["owner", "service"]); // Reinigung sieht keine Bestellungen
    expect(await who("bookings", "k:bookings")).toEqual(["owner"]); // Service sieht keine Hotelbuchungen
    expect(await who("other", "k:other")).toEqual(["owner"]); // Sonstiges nur Inhaber/Manager
    await savePushPrefs(h.hotel.id, service, { orders: false });
    expect(await who("orders", "k:orders2")).toEqual(["owner"]); // Service hat Bestellungen abgestellt
    await savePushPrefs(h.hotel.id, cleaning, { orders: true });
    expect(await who("orders", "k:orders3")).toEqual(["owner"]); // eine Wahl gibt keinen Zugang zu dem, was die Rolle nicht sieht
  });
  it("Sammelmeldung: mehrere neue Bestellungen im selben Lauf werden eine Meldung; die Erinnerung bleibt einzeln", async () => {
    const h = await makeHotel();
    await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "restaurant", enabled: true });
    const owner = await member(h.hotel.id, "owner");
    await saveSubscription(h.hotel.id, owner, sub("sammel" + h.hotel.id), null);
    const url = `/admin/${h.hotel.id}/restaurant/bestellungen`;
    for (const n of ["a", "b", "c"]) await enqueuePush(db(), h.hotel.id, `order:${n}`, { title: `Neue Bestellung ${n}`, body: "x", url, kind: "orders" });
    await enqueuePush(db(), h.hotel.id, "order-alarm:a", { title: "Bestellung wartet", body: "x", url, kind: "orders" });
    const got: PushPayload[] = [];
    setPushSender(async (_t, p) => void got.push(p));
    await sendDuePushes();
    expect(got.map((p) => p.title).sort()).toEqual(["3 neue Bestellungen", "Bestellung wartet"]);
    expect((await pending(h.hotel.id)).every((r) => r.status === "sent")).toBe(true);
  });
});
