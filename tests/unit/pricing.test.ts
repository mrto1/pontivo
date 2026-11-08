import { describe, expect, it } from "vitest";
import { platformFee, priceStay, grandTotal, occupancyPrices, pricesVaryByOccupancy } from "../../src/domain/pricing";
import { computeTouristTax, pickRule, TouristTaxUnconfirmedError } from "../../src/domain/tourist-tax";
import { bpsOf, decimalToRappen, formatChf, rappenToDecimal } from "../../src/domain/money";

const plan = (o: Partial<{ baseOccupancy: number; extraAdultRappen: number; singleDiscountRappen: number }> = {}) => ({
  baseOccupancy: 2, extraAdultRappen: 0, singleDiscountRappen: 0, ...o,
});
const nights = (prices: number[]) => prices.map((p, i) => ({ night: `2026-12-0${i + 1}`, priceRappen: p }));

const glarus = { adultRappen: 440, reducedRappen: 220, freeUnderAge: 6, reducedUnderAge: 16, status: "verified" };
const stGallen = { adultRappen: 450, reducedRappen: null, freeUnderAge: 16, reducedUnderAge: null, status: "verified" };
const egnach = { adultRappen: 0, reducedRappen: null, freeUnderAge: 0, reducedUnderAge: null, status: "none" };

describe("SPEC 5.2 Preisberechnung", () => {
  it("2 Nächte à 18000, 2 Erw., Kurtaxe 300 → rooms 36000, tax 1200, total 37200, fee 372", () => {
    const { roomsTotalRappen } = priceStay(nights([18000, 18000]), plan(), 2, 0);
    const tax = computeTouristTax({ adultRappen: 300, reducedRappen: null, freeUnderAge: 0, reducedUnderAge: null, status: "verified" }, { adults: 2, childrenAges: [], nights: 2 });
    const total = grandTotal(roomsTotalRappen, tax, false);
    expect(roomsTotalRappen).toBe(36000);
    expect(tax).toBe(1200);
    expect(total).toBe(37200);
    expect(platformFee(total, 100)).toBe(372);
  });

  it("1 Erwachsener, single_discount 2000, 3 Nächte à 15000 → 39000", () => {
    expect(priceStay(nights([15000, 15000, 15000]), plan({ singleDiscountRappen: 2000 }), 1, 0).roomsTotalRappen).toBe(39000);
  });

  it("3 Erwachsene, base 2, extra 4000, 1 Nacht à 20000 → 24000", () => {
    expect(priceStay(nights([20000]), plan({ extraAdultRappen: 4000 }), 3, 0).roomsTotalRappen).toBe(24000);
  });

  it("Glarus: 2 Nächte, 2 Erw. + Kinder 4 und 10 → 2200", () => {
    expect(computeTouristTax(glarus, { adults: 2, childrenAges: [4, 10], nights: 2 })).toBe(2200);
  });

  it("St. Gallen: 1 Nacht, 1 Erw. + Kind 15 → 450", () => {
    expect(computeTouristTax(stGallen, { adults: 1, childrenAges: [15], nights: 1 })).toBe(450);
  });

  it("Egnach (status none) → 0", () => {
    expect(computeTouristTax(egnach, { adults: 2, childrenAges: [], nights: 3 })).toBe(0);
  });

  it("Kurtaxe inklusive: total = rooms", () => {
    expect(grandTotal(36000, 1200, true)).toBe(36000);
  });

  it("Unbestätigte Regel wirft", () => {
    expect(() => computeTouristTax(null, { adults: 1, childrenAges: [], nights: 1 })).toThrow(TouristTaxUnconfirmedError);
    expect(() => computeTouristTax({ ...glarus, adultRappen: null, status: "needs_confirmation" }, { adults: 1, childrenAges: [], nights: 1 })).toThrow(TouristTaxUnconfirmedError);
  });

  it("Kind ohne Alter → reduzierter Satz", () => {
    expect(computeTouristTax(glarus, { adults: 0, childrenAges: [null], nights: 1 })).toBe(220);
  });

  it("Einzelrabatt nie unter 1 Rappen", () => {
    expect(priceStay(nights([1000]), plan({ singleDiscountRappen: 5000 }), 1, 0).roomsTotalRappen).toBe(1);
  });

  it("Gebühr: mindestens 1, kleiner als total, half-up", () => {
    expect(platformFee(50, 100)).toBe(1);
    expect(platformFee(150, 100)).toBe(2); // 1.5 → 2
    expect(platformFee(149, 100)).toBe(1);
    expect(platformFee(2, 10000)).toBe(1);
  });

  it("Regelwahl: jüngstes valid_from <= checkin", () => {
    const r = [{ validFrom: "2024-01-01", v: 1 }, { validFrom: "2026-01-01", v: 2 }, { validFrom: "2027-01-01", v: 3 }];
    expect(pickRule(r, "2026-06-01")?.v).toBe(2);
    expect(pickRule(r, "2023-06-01")).toBeNull();
  });
});

describe("Geld", () => {
  it("bps und Dezimal", () => {
    expect(bpsOf(37200, 100)).toBe(372);
    expect(rappenToDecimal(18000)).toBe("180.00");
    expect(rappenToDecimal(5)).toBe("0.05");
    expect(decimalToRappen("180.5")).toBe(18050);
    expect(decimalToRappen("0.07")).toBe(7);
    expect(formatChf(123456)).toBe("CHF 1'234.56");
  });
});

describe("Preise je Belegung (Channex per_person)", () => {
  const plan = { baseOccupancy: 2, extraAdultRappen: 4000, singleDiscountRappen: 2000 };
  it("1 bis max. Erwachsene wie auf der Buchungsseite", () => {
    expect(occupancyPrices(18000, plan, 4)).toEqual([
      { occupancy: 1, price_rappen: 16000 },
      { occupancy: 2, price_rappen: 18000 },
      { occupancy: 3, price_rappen: 22000 },
      { occupancy: 4, price_rappen: 26000 },
    ]);
  });
  it("per_person nur, wenn der Preis von der Belegung abhängt", () => {
    expect(pricesVaryByOccupancy(plan, 2)).toBe(true);
    expect(pricesVaryByOccupancy({ baseOccupancy: 2, extraAdultRappen: 4000, singleDiscountRappen: 0 }, 2)).toBe(false);
    expect(pricesVaryByOccupancy({ baseOccupancy: 1, extraAdultRappen: 4000, singleDiscountRappen: 0 }, 1)).toBe(false);
    expect(pricesVaryByOccupancy({ baseOccupancy: 2, extraAdultRappen: 0, singleDiscountRappen: 0 }, 4)).toBe(false);
  });
});
