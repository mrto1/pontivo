import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { bookingExtras, bookings } from "../../src/db/schema";
import { BookingError, cancelBooking, cancellationPreview, createDirectBooking } from "../../src/services/bookings";
import { searchOffers } from "../../src/services/search";
import { createExtra, deleteExtra, ExtraAdminError, updateExtra } from "../../src/services/extras";
import { extraAmount, ExtrasError, resolveExtras, type ExtraDef } from "../../src/domain/extras";
import { platformFee } from "../../src/domain/pricing";
import { render } from "../../src/email/templates";
import { setPaymentProvider } from "../../src/payments/provider";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

const def = (o: Partial<ExtraDef> & { id: string }): ExtraDef => ({ priceRappen: 1000, unit: "per_booking", maxQuantity: 1, mandatory: false, active: true, roomTypeIds: [], ...o });

describe("Zusatzleistungen: Rechnen", () => {
  it("Einheiten, Mengen, obligatorische, Zimmer-Einschränkung", () => {
    expect(extraAmount({ priceRappen: 1500, unit: "per_night" }, 2, 3)).toBe(9000);
    expect(extraAmount({ priceRappen: 1800, unit: "per_person_night" }, 2, 3)).toBe(10800);
    expect(extraAmount({ priceRappen: 8000, unit: "per_booking" }, 1, 3)).toBe(8000);
    const defs = [
      def({ id: "dog", priceRappen: 1500, unit: "per_night", maxQuantity: 2 }),
      def({ id: "bf", priceRappen: 1800, unit: "per_person_night" }),
      def({ id: "clean", priceRappen: 8000, mandatory: true }),
      def({ id: "suite-only", roomTypeIds: ["suite"] }),
      def({ id: "off", active: false }),
    ];
    const ctx = { roomTypeId: "dz", nights: 3, persons: 2 };
    expect(resolveExtras(defs, [], ctx).totalRappen).toBe(8000); // nur Endreinigung
    const r = resolveExtras(defs, [{ id: "dog", quantity: 1 }, { id: "bf", quantity: 2 }, { id: "clean", quantity: 0 }], ctx);
    expect(r.lines.map((l) => [l.extra.id, l.quantity, l.amountRappen])).toEqual([["dog", 1, 4500], ["bf", 2, 10800], ["clean", 1, 8000]]);
    expect(r.totalRappen).toBe(23300);
    for (const bad of [[{ id: "dog", quantity: 3 }], [{ id: "bf", quantity: 3 }], [{ id: "suite-only", quantity: 1 }], [{ id: "off", quantity: 1 }], [{ id: "x", quantity: 1 }], [{ id: "dog", quantity: -1 }], [{ id: "dog", quantity: 1 }, { id: "dog", quantity: 1 }]]) {
      expect(() => resolveExtras(defs, bad, ctx)).toThrow(ExtrasError);
    }
    expect(resolveExtras(defs, [{ id: "suite-only", quantity: 1 }], { ...ctx, roomTypeId: "suite" }).totalRappen).toBe(9000);
  });
});

describe("Zusatzleistungen: Buchung", () => {
  it("Suche zeigt Preis inkl. obligatorischer Leistungen; Buchung bepreist serverseitig, friert ein, 1 % auf alles", async () => {
    const { hotel, rooms } = await makeHotel();
    const rt = rooms[0].roomType.id, rp = rooms[0].plans[0].id;
    const checkin = inDays(20), checkout = addDays(checkin, 3);
    const before = await searchOffers(hotel, { checkin, checkout, adults: 2, children: 0 });
    if (!before.ok) throw new Error("search");
    const base = before.offers[0].totalRappen;

    await expect(createExtra(hotel.id, { name: {}, priceRappen: 100, unit: "per_booking" }, "t")).rejects.toThrow();
    await expect(createExtra(hotel.id, { name: { de: "X" }, priceRappen: 100, unit: "per_booking", roomTypeIds: ["00000000-0000-0000-0000-000000000000"] }, "t")).rejects.toThrow(ExtraAdminError);
    const clean = await createExtra(hotel.id, { name: { de: "Endreinigung", en: "Final cleaning" }, priceRappen: 8000, unit: "per_booking", mandatory: true }, "t");
    const dog = await createExtra(hotel.id, { name: { de: "Hund", en: "Dog" }, priceRappen: 1500, unit: "per_night", maxQuantity: 2 }, "t");
    const bf = await createExtra(hotel.id, { name: { de: "Frühstück" }, priceRappen: 1800, unit: "per_person_night" }, "t");

    const after = await searchOffers(hotel, { checkin, checkout, adults: 2, children: 0 }, { lang: "en" });
    if (!after.ok) throw new Error("search");
    expect(after.offers[0].totalRappen).toBe(base + 8000);
    expect(after.offers[0].mandatoryExtras).toEqual([{ name: "Final cleaning", amountRappen: 8000 }]);

    // manipulierte Menge → 400
    await expect(createDirectBooking(hotel, { roomTypeId: rt, ratePlanId: rp, checkin, checkout, adults: 2, children: 0, childrenAges: [], guest, extras: [{ id: dog.id, quantity: 5 }] }))
      .rejects.toMatchObject({ code: "extra_invalid", httpStatus: 400 });

    const { booking: held } = await createDirectBooking(hotel, { roomTypeId: rt, ratePlanId: rp, checkin, checkout, adults: 2, children: 0, childrenAges: [], guest,
      extras: [{ id: dog.id, quantity: 1 }, { id: bf.id, quantity: 2 }] });
    const [b] = await db().select().from(bookings).where(eq(bookings.id, held.id));
    const extrasTotal = 8000 + 1500 * 3 + 1800 * 2 * 3;
    expect(b.extrasRappen).toBe(extrasTotal);
    expect(b.totalRappen).toBe(base + extrasTotal);
    expect(b.platformFeeRappen).toBe(platformFee(b.totalRappen, hotel.platformFeeBps));
    const lines = await db().select().from(bookingExtras).where(eq(bookingExtras.bookingId, b.id));
    expect(lines.map((l) => [l.name.de, l.quantity, l.amountRappen]).sort()).toEqual([["Endreinigung", 1, 8000], ["Frühstück", 2, 10800], ["Hund", 1, 4500]]);

    // Preisänderung und Löschen danach ändern die Buchung nicht
    await updateExtra(hotel.id, dog.id, { name: { de: "Hund" }, priceRappen: 9900, unit: "per_night", maxQuantity: 2 }, "t");
    await deleteExtra(hotel.id, bf.id, "t");
    const kept = await db().select().from(bookingExtras).where(eq(bookingExtras.bookingId, b.id));
    expect(kept.reduce((s, l) => s + l.amountRappen, 0)).toBe(extrasTotal);
    expect(kept.find((l) => l.name.de === "Frühstück")!.extraId).toBeNull();

    // Mail und Storno: Zusatzleistungen stehen in der Bestätigung; Stornogebühr nur auf den Zimmerpreis
    const mail = render("booking_confirmed", "de", { hotel, booking: b, data: {}, baseUrl: "https://x", extras: kept });
    expect(mail.text).toContain("Endreinigung: CHF 80.00");
    expect(mail.text).toContain("Frühstück × 2: CHF 108.00");
    const q = await cancellationPreview(b.id, { by: "guest" });
    expect(q.refundRappen).toBe(b.totalRappen - q.feeRappen);
    expect(q.feeRappen).toBeLessThanOrEqual(b.roomsTotalRappen);
    const r = await cancelBooking(b.id, { by: "guest", actor: "guest" });
    expect(r.refundRappen).toBe(q.refundRappen);
    void clean;
    void BookingError;
  });

  it("Zusatzleistung eines anderen Hotels wird abgelehnt", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const foreign = await createExtra(b.hotel.id, { name: { de: "Sauna" }, priceRappen: 2000, unit: "per_booking" }, "t");
    const checkin = inDays(25);
    await expect(createDirectBooking(a.hotel, { roomTypeId: a.rooms[0].roomType.id, ratePlanId: a.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 1), adults: 2, children: 0, childrenAges: [], guest, extras: [{ id: foreign.id, quantity: 1 }] }))
      .rejects.toMatchObject({ code: "extra_invalid" });
  });
});
