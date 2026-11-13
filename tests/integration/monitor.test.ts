import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, emailOutbox, hotels, payments, systemStatus } from "../../src/db/schema";
import { beat, checkSystem, raiseAlert, runWatchdog } from "../../src/services/monitor";
import { reconcilePayments } from "../../src/services/reconcile";
import { createDirectBooking, confirmBooking } from "../../src/services/bookings";
import { GET as health } from "../../app/api/health/route";
import nextConfig, { adminHeaders, securityHeaders } from "../../next.config";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

/** Gemeinsame Test-Datenbank: Rückstände anderer Tests wegräumen, damit nur die eigenen zählen */
beforeEach(async () => {
  await db().execute(sql`DELETE FROM email_outbox WHERE status = 'pending'`);
  await db().execute(sql`DELETE FROM channex_outbox WHERE status = 'pending'`);
  await db().execute(sql`UPDATE bookings SET hold_expires_at = now() + interval '1 day' WHERE status = 'hold'`);
  await db().delete(systemStatus);
});

const names = async (opts: Parameters<typeof checkSystem>[0]) => (await checkSystem(opts)).map((p) => p.name);
const old = (min: number) => new Date(Date.now() - min * 60_000);

describe("Überwachung", () => {
  it("Worker: ohne oder mit altem Lebenszeichen ein Problem, mit frischem keines", async () => {
    expect(await names({ includeWorker: true, diskRatio: 0.5 })).toContain("worker");
    await beat(old(10));
    expect(await names({ includeWorker: true, diskRatio: 0.5 })).toContain("worker");
    await beat();
    expect(await names({ includeWorker: true, diskRatio: 0.5 })).not.toContain("worker");
    expect(await names({ includeWorker: false, diskRatio: 0.5 })).toEqual([]);
  });

  it("Rückstau bei E-Mail, hängende Reservierung und knapper Speicher werden erkannt", async () => {
    const h = await makeHotel();
    await db().insert(emailOutbox).values({ hotelId: h.hotel.id, template: "platform_alert", toEmail: "x@example.ch", sendAfter: old(45), data: {} });
    expect(await names({ includeWorker: false, diskRatio: 0.5 })).toEqual(["email_backlog"]);
    await db().insert(emailOutbox).values({ hotelId: h.hotel.id, template: "platform_alert", toEmail: "x@example.ch", sendAfter: new Date(), data: {} });
    expect(await names({ includeWorker: false, diskRatio: 0.05 })).toEqual(["email_backlog", "disk"]);
    await db().execute(sql`DELETE FROM email_outbox WHERE status = 'pending'`);

    const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    const d = inDays(20);
    const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    await db().update(bookings).set({ status: "hold", holdExpiresAt: old(45) }).where(eq(bookings.id, booking.id));
    expect(await names({ includeWorker: false, diskRatio: 0.5 })).toEqual(["stuck_holds"]);
  });

  it("Alarm: eine Mail pro Problem, nicht wiederholt; nach Behebung und Rückfall wieder", async () => {
    const h = await makeHotel();
    const stuck = () => db().insert(emailOutbox).values({ hotelId: h.hotel.id, template: "booking_confirmed", toEmail: "g@example.ch", sendAfter: old(45), data: {} });
    await stuck();
    expect(await runWatchdog(new Date(), 0.5)).toEqual({ problems: 1, sent: 1 });
    expect(await runWatchdog(new Date(), 0.5)).toEqual({ problems: 1, sent: 0 });
    const alerts = await db().select().from(emailOutbox).where(eq(emailOutbox.template, "platform_alert"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].toEmail).toBe("alarm@example.ch");
    // behoben → Schlüssel verschwindet → Rückfall meldet wieder
    await db().execute(sql`DELETE FROM email_outbox WHERE template = 'booking_confirmed'`);
    expect(await runWatchdog(new Date(), 0.5)).toEqual({ problems: 0, sent: 0 });
    await stuck();
    expect(await runWatchdog(new Date(), 0.5)).toEqual({ problems: 1, sent: 1 });
    // raiseAlert: nach Ablauf der Frist wieder
    expect(await raiseAlert("x", "S", "D", new Date(), 1000)).toBe(true);
    expect(await raiseAlert("x", "S", "D", new Date(), 1000)).toBe(false);
    expect(await raiseAlert("x", "S", "D", new Date(Date.now() + 5000), 1000)).toBe(true);
  });

  it("/api/health: einfach nur Datenbank, mit deep=1 auch der Worker (nur Namen, keine Details)", async () => {
    const simple = await health(new Request("http://x/api/health"));
    expect(simple.status).toBe(200);
    expect(await simple.json()).toEqual({ ok: true });
    const deep = await health(new Request("http://x/api/health?deep=1"));
    const j = await deep.json();
    expect(j.problems).toContain("worker");
    expect(deep.status).toBe(503);
    await beat();
    const j2 = await (await health(new Request("http://x/api/health?deep=1"))).json();
    expect(j2.problems).not.toContain("worker");
    expect(JSON.stringify(j2)).not.toMatch(/Kein Lebenszeichen|\d{4}-\d{2}-\d{2}T/);
  });
});

describe("Zahlungsabgleich", () => {
  async function booked() {
    const h = await makeHotel();
    const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    const d = inDays(30);
    const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    return { hotel, booking };
  }
  const flagged = async (kind: string, id: string) => (await db().select().from(systemStatus).where(eq(systemStatus.key, `alert:reconcile:${kind}:${id}`))).length === 1;
  const setPay = (bookingId: string, v: Partial<typeof payments.$inferInsert>) => db().update(payments).set(v).where(eq(payments.bookingId, bookingId));

  it("sauber: bestätigte Buchung mit erfolgreicher Zahlung wird nicht gemeldet", async () => {
    const { booking } = await booked();
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    await setPay(booking.id, { status: "succeeded" });
    await reconcilePayments(new Date(), { sessionPaid: async () => false });
    for (const k of ["A", "B", "C"]) expect(await flagged(k, booking.id)).toBe(false);
  });

  it("B: bestätigt ohne erfolgreiche Zahlung", async () => {
    const { booking } = await booked();
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    await setPay(booking.id, { status: "failed" });
    await reconcilePayments(new Date(), { sessionPaid: async () => false });
    expect(await flagged("B", booking.id)).toBe(true);
  });

  it("C: bezahlt, aber Buchung abgelaufen und nichts rückerstattet", async () => {
    const { booking } = await booked();
    await db().update(bookings).set({ status: "expired" }).where(eq(bookings.id, booking.id));
    await setPay(booking.id, { status: "succeeded", refundedRappen: 0 });
    await reconcilePayments(new Date(), { sessionPaid: async () => false });
    expect(await flagged("C", booking.id)).toBe(true);
  });

  it("A: bei Stripe bezahlt, aber nie bestätigt; nur wenn Stripe wirklich «paid» sagt", async () => {
    const paid = await booked();
    const unpaid = await booked();
    for (const b of [paid.booking, unpaid.booking]) {
      await db().update(bookings).set({ status: "expired" }).where(eq(bookings.id, b.id));
      await setPay(b.id, { status: "pending", createdAt: old(60) });
    }
    const sessions = await db().select().from(payments).where(eq(payments.bookingId, paid.booking.id));
    await reconcilePayments(new Date(), { sessionPaid: async (_h, s) => s === sessions[0].stripeCheckoutSessionId });
    expect(await flagged("A", paid.booking.id)).toBe(true);
    expect(await flagged("A", unpaid.booking.id)).toBe(false);
    // Fehler bei Stripe: kein Absturz, keine Meldung
    const r = await reconcilePayments(new Date(), { sessionPaid: async () => { throw new Error("Stripe down"); } });
    expect(r.issues).toBeGreaterThanOrEqual(0);
    // Wiederholter Lauf meldet nicht noch einmal (24 Stunden)
    const before = (await db().select().from(emailOutbox).where(like(emailOutbox.template, "platform_alert"))).length;
    await reconcilePayments(new Date(), { sessionPaid: async (_h, s) => s === sessions[0].stripeCheckoutSessionId });
    expect((await db().select().from(emailOutbox).where(like(emailOutbox.template, "platform_alert"))).length).toBe(before);
  });
});

describe("Sicherheits-Kopfzeilen", () => {
  it("überall nosniff, Referrer, Permissions; im Admin kein fremder Rahmen", async () => {
    const keys = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
    expect(keys["X-Content-Type-Options"]).toBe("nosniff");
    expect(keys["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(keys["Permissions-Policy"]).toContain("camera=()");
    expect(keys["Content-Security-Policy"]).toContain("object-src 'none'");
    // die öffentliche Buchungsseite muss einbettbar bleiben (Widget auf Hotel-Websites)
    expect(securityHeaders.some((h) => h.key === "X-Frame-Options")).toBe(false);
    expect(adminHeaders).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    const rules = await nextConfig.headers!();
    expect(rules.map((r) => r.source)).toEqual(["/:path*", "/admin/:path*"]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
