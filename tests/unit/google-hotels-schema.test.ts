import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  availabilityMessage, availRuns, hotelListFeed, inventoryMessage, inventoryRuns, landingPagesFile, propertyDataMessage, rateMessage, rateRuns, rangeDays, taxFeeMessage, type Meta,
} from "../../src/domain/google-hotels";
import type { TaxRule } from "../../src/domain/tourist-tax";

/**
 * Nachrichten gegen Googles veröffentlichte Schemas prüfen (developers.google.com/hotels/hotel-prices/dev-guide/schemas).
 * Die XSDs liegen als Kopie in tests/fixtures/google-xsd (Stand 2026-11), damit der Test ohne Netz läuft.
 */
const DIR = join(__dirname, "../fixtures/google-xsd");
const hasXmllint = (() => { try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
function validate(xsd: string, xml: string): string {
  try {
    execFileSync("xmllint", ["--noout", "--schema", join(DIR, xsd), "-"], { input: xml, stdio: ["pipe", "pipe", "pipe"] });
    return "ok";
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

const meta: Meta = { ts: new Date("2026-11-27T10:00:00Z"), id: "rate-abc_1", partner: "pk1" };
const GL: TaxRule = { adultRappen: 440, reducedRappen: 220, freeUnderAge: 6, reducedUnderAge: 16, status: "verified" };

describe.skipIf(!hasXmllint)("Google Hotelpreise: Schema-Prüfung (SPEC 19.70)", () => {
  it("Hotelliste und Landingpage-Datei", () => {
    const list = hotelListFeed([{ id: "h1", name: "Hotel Rössli", street: "Seestrasse 1", city: "Luzern", postalCode: "6000", canton: "LU", country: "CH", lat: 47.05, lng: 8.3, phone: "+41410000000", category: "hotel" }]);
    expect(validate("local_feed.xsd", list)).toBe("ok");
    expect(validate("point_of_sale.xsd", landingPagesFile("https://pontivo.ch"))).toBe("ok");
  });

  it("Property Data", () => {
    const xml = propertyDataMessage(meta, "h1", [{ id: "r1", name: "Doppelzimmer", description: "", photos: [{ url: "https://x.ch/a.jpg", alt: "Zimmer" }], maxOccupancy: 4, maxAdults: 2, maxChildren: 2, planIds: ["p1", "p2"] }],
      [{ id: "p1", name: "Flex", description: "Flex", freeCancelHours: 48, checkinTime: "15:00:00", breakfast: true, dinner: false }, { id: "p2", name: "Fix", description: "Fix", freeCancelHours: null, checkinTime: "15:00", breakfast: false, dinner: false }], "de");
    expect(validate("transaction_property_data.xsd", xml)).toBe("ok");
  });

  it("Preise, Bestand, Einschränkungen", () => {
    const days = rangeDays("2026-12-01", 5);
    const runs = rateRuns([{ night: "2026-12-01", priceRappen: 18000 }, { night: "2026-12-03", priceRappen: 20000 }], { baseOccupancy: 2, extraAdultRappen: 3000, singleDiscountRappen: 2000 }, 3, days);
    expect(validate("ota_hotel_rate_amount_notif_rq.xsd", rateMessage(meta, "h1", [{ roomId: "r1", planId: "p1", runs }], "CHF", true))).toBe("ok");
    expect(validate("ota_hotel_rate_amount_notif_rq.xsd", rateMessage(meta, "h1", [{ roomId: "r1", planId: "p1", runs }], "CHF", false))).toBe("ok");
    const inv = inventoryRuns([{ night: "2026-12-01", total: 3, booked: 1, blocked: 0, externalBlocked: 0 }], true, days);
    expect(validate("ota_hotel_inv_count_notif_rq.xsd", inventoryMessage(meta, "h1", [{ roomId: "r1", runs: inv }]))).toBe("ok");
    const av = availRuns([{ night: "2026-12-01", minStayArrival: 2, maxStay: 7, closedToArrival: true, closedToDeparture: true, stopSell: false }], { minNights: 3, arrivalWeekdays: [1], active: true }, days);
    expect(validate("ota_hotel_avail_notif_rq.xsd", availabilityMessage(meta, "h1", [{ roomId: "r1", planId: "p1", runs: av }]))).toBe("ok");
  });

  it("Kurtaxe und Pflichtgebühren", () => {
    expect(validate("tax_fee_info.xsd", taxFeeMessage(meta, "h1", GL, false, "CHF"))).toBe("ok");
    expect(validate("tax_fee_info.xsd", taxFeeMessage(meta, "h1", GL, true, "CHF"))).toBe("ok");
    const fees = [
      { unit: "per_booking" as const, rappen: 5000, roomIds: [] },
      { unit: "per_night" as const, rappen: 1000, roomIds: ["r1", "r2"] },
      { unit: "per_person" as const, rappen: 500, roomIds: [] },
      { unit: "per_person_night" as const, rappen: 800, roomIds: ["r1"] },
    ];
    const xml = taxFeeMessage(meta, "h1", GL, false, "CHF", fees);
    expect(xml).toContain("<Basis>room</Basis>");
    expect(xml).toContain("<Basis>person</Basis>");
    expect(validate("tax_fee_info.xsd", xml)).toBe("ok");
    expect(validate("tax_fee_info.xsd", taxFeeMessage(meta, "h1", null, true, "CHF", fees))).toBe("ok");
  });
});
