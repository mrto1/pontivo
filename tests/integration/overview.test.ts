import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { bookings, hotels } from "../../src/db/schema";
import { createDirectBooking } from "../../src/services/bookings";
import { overview, periodMonths, setOtaCommission } from "../../src/services/overview";
import { bpsOf } from "../../src/domain/money";
import { todayIn } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Übersicht «Ihr Nutzen»", () => {
  it("Zeiträume", () => {
    expect(periodMonths("month", "2026-11-10")).toEqual(["2026-11"]);
    expect(periodMonths("last", "2026-01-10")).toEqual(["2025-12"]);
    expect(periodMonths("year", "2026-03-10")).toEqual(["2026-01", "2026-02", "2026-03"]);
    const y = periodMonths("12m", "2026-11-10");
    expect(y).toHaveLength(12);
    expect(y[0]).toBe("2025-12");
    expect(y[11]).toBe("2026-11");
  });

  it("Ersparnis = Zimmerumsatz direkt × Provision − Pontivo-Gebühr; Direktanteil; Provision änderbar", async () => {
    const { hotel, rooms } = await makeHotel();
    const { booking: held } = await createDirectBooking(hotel, {
      roomTypeId: rooms[0].roomType.id, ratePlanId: rooms[0].plans[0].id, checkin: inDays(10), checkout: inDays(12), adults: 2, children: 0, childrenAges: [], guest,
    });
  const [booking] = await db().select().from(bookings).where(eq(bookings.id, held.id));
  expect(booking.status).toBe("confirmed");
    await db().insert(bookings).values({ hotelId: hotel.id, reference: `OTA-${booking.reference}`, publicToken: `ota-${booking.publicToken}`, source: "booking_com", status: "confirmed",
      checkin: inDays(20), checkout: inDays(21), adults: 2, roomsTotalRappen: 18000, totalRappen: 18880, confirmedAt: new Date() });
    // stornierte Direktbuchung zählt nicht
    await db().insert(bookings).values({ hotelId: hotel.id, reference: `X-${booking.reference}`, publicToken: `x-${booking.publicToken}`, source: "direct", status: "cancelled",
      checkin: inDays(30), checkout: inDays(31), adults: 2, roomsTotalRappen: 50000, totalRappen: 50000, platformFeeRappen: 500, confirmedAt: new Date() });

    const o = await overview(hotel, "month");
    expect(o.direct.bookings).toBe(1);
    expect(o.direct.roomsRappen).toBe(booking.roomsTotalRappen);
    expect(o.direct.feeRappen).toBe(booking.platformFeeRappen);
    expect(o.savedRappen).toBe(bpsOf(booking.roomsTotalRappen, 1500) - booking.platformFeeRappen);
    expect(o.portal.bookings).toBe(1);
    expect(o.directSharePct).toBe(50);
    const cur = o.chart.find((c) => c.month === todayIn(hotel.timezone).slice(0, 7))!;
    expect(cur).toMatchObject({ direct: 1, portal: 1 });
    expect(o.chart).toHaveLength(12);

    await setOtaCommission(hotel.id, 1800, "user:x");
    const [h2] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    const o2 = await overview(h2, "month");
    expect(o2.commissionBps).toBe(1800);
    expect(o2.savedRappen).toBe(bpsOf(booking.roomsTotalRappen, 1800) - booking.platformFeeRappen);
    await expect(setOtaCommission(hotel.id, 5000, "user:x")).rejects.toThrow();
    // letzter Monat: leer
    expect((await overview(h2, "last")).direct.bookings).toBe(0);
  });
});
