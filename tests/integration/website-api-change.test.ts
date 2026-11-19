import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, guests, hotelModules, webhookDeliveries } from "../../src/db/schema";
import { createApiKey } from "../../src/services/posbridge";
import { POST as bookPost } from "../../app/api/v1/bookings/route";
import { PATCH as patchBooking } from "../../app/api/v1/bookings/[reference]/route";
import { createEndpoint } from "../../src/services/webhooks";
import { setPaymentProvider } from "../../src/payments/provider";
import { addDays } from "../../src/domain/dates";
import { inDays, inv, makeHotel } from "../helpers";

afterAll(async () => { setPaymentProvider(null); await closeDb(); });

async function setup() {
  const h = await makeHotel({ weekendSurchargeRappen: 4000 }, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 20000 }]);
  await db().insert(hotelModules).values({ hotelId: h.hotel.id, module: "api", enabled: true });
  const { key } = await createApiKey(h.hotel.id, "Agentur", "t", "website");
  return { ...h, key, rt: h.rooms[0].roomType.id, rp: h.rooms[0].plans[0].id };
}
const book = async (a: Awaited<ReturnType<typeof setup>>, ci: string, nights = 1) => {
  const r = await bookPost(new Request("http://x/api/v1/bookings", { method: "POST", headers: { authorization: `Bearer ${a.key}`, "content-type": "application/json" }, body: JSON.stringify({ room_type_id: a.rt, rate_plan_id: a.rp, checkin: ci, checkout: addDays(ci, nights), adults: 2, children: 0, guest: { first_name: "Anna", last_name: "Muster", email: "anna@example.ch", language: "de" }, terms_accepted: true }) }));
  expect(r.status).toBe(201);
  return (await r.json()).reference as string;
};
const patch = (key: string, ref: string, body: unknown, headers: Record<string, string> = {}) =>
  patchBooking(new Request(`http://x/api/v1/bookings/${ref}`, { method: "PATCH", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ reference: ref }) });
const row = async (ref: string) => (await db().select().from(bookings).where(eq(bookings.reference, ref)))[0];

describe("Website-Schnittstelle: nachträgliche Änderung (SPEC 19.24)", () => {
  it("Verschieben: Probelauf ändert nichts, echte Änderung gibt Nächte um, Ereignis booking.changed; Preisunterschied und Ausgebucht bleiben ohne Wirkung", async () => {
    const a = await setup();
    await createEndpoint(a.hotel.id, "https://hooks.agentur.ch/x", [], "t");
    const ci = inDays(60);
    const ref = await book(a, ci);
    // Ein Tag mit gleichem Preis und einer mit anderem Preis (Wochenendzuschlag) finden
    let same: string | null = null, diff: string | null = null;
    for (let k = 1; k <= 8 && !(same && diff); k++) {
      const d = addDays(ci, k);
      const r = await patch(a.key, ref, { checkin: d, dry_run: true });
      if (r.status === 200) same ??= d;
      else { expect((await r.json()).error).toBe("price_differs"); diff ??= d; }
    }
    expect(same && diff).toBeTruthy();
    // Probelauf und abgelehnter Preis haben nichts verändert
    expect((await row(ref)).checkin).toBe(ci);
    expect((await inv(a.rt, ci)).booked).toBe(1);
    expect((await inv(a.rt, same!)).booked).toBe(0);
    const pd = await patch(a.key, ref, { checkin: diff! });
    expect(pd.status).toBe(409);
    const pdj = await pd.json();
    expect(pdj.new_rooms_rappen).not.toBe(pdj.current_rooms_rappen);
    expect((await row(ref)).checkin).toBe(ci);
    // Echt verschieben
    const ok = await patch(a.key, ref, { checkin: same! }, { "idempotency-key": "move-key-0001" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ checkin: same, checkout: addDays(same!, 1), changed: ["checkin", "checkout"], dry_run: false });
    const replay = await patch(a.key, ref, { checkin: same! }, { "idempotency-key": "move-key-0001" });
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await inv(a.rt, ci)).booked).toBe(0);
    expect((await inv(a.rt, same!)).booked).toBe(1);
    const ev = (await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.hotelId, a.hotel.id))).map((d) => d.event);
    expect(ev).toContain("booking.changed");
    // Ausgebucht: zweite Buchung belegt das Ziel
    const target = addDays(same!, 7);
    const ref2 = await book(a, target);
    const so = await patch(a.key, ref, { checkin: target, dry_run: true });
    expect([409]).toContain(so.status);
    expect(["sold_out", "price_differs"]).toContain((await so.json()).error);
    expect((await row(ref)).checkin).toBe(same);
    expect((await row(ref2)).checkin).toBe(target);
  });

  it("Gästedaten ändern, ungültige Eingaben 400, fremder Betrieb 404, stornierte Buchung 409", async () => {
    const a = await setup(), b = await setup();
    const ref = await book(a, inDays(90));
    const r = await patch(a.key, ref, { guest: { first_name: "Berta", phone: "+41791234567" } });
    expect(r.status).toBe(200);
    expect((await r.json()).changed).toEqual(["first_name", "phone"]);
    const bk = await row(ref);
    const [g] = await db().select().from(guests).where(eq(guests.id, bk.guestId!));
    expect(g).toMatchObject({ firstName: "Berta", lastName: "Muster", phone: "+41791234567", email: "anna@example.ch" });
    expect((await patch(a.key, ref, { guest: { email: "x@y.ch" } })).status).toBe(400); // E-Mail nicht änderbar
    expect((await patch(a.key, ref, {})).status).toBe(400);
    expect((await patch(a.key, ref, { checkin: "2026-13-45" })).status).toBe(400);
    expect((await patch(b.key, ref, { guest: { first_name: "X" } })).status).toBe(404);
    await db().update(bookings).set({ status: "cancelled" }).where(and(eq(bookings.reference, ref)));
    const c = await patch(a.key, ref, { guest: { first_name: "Y" } });
    expect(c.status).toBe(409);
  });
});
