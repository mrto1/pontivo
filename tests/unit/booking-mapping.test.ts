import { describe, expect, it } from "vitest";
import { buildBookingMappings, MappingError, pairKey } from "../../src/integrations/channex/booking-mapping";
import type { BookingMappingDetails } from "../../src/integrations/channex/client";

const rate = (id: number, occupancies: number[], extra: Partial<BookingMappingDetails["rooms"][0]["rates"][0]> = {}) => ({
  id, title: `Rate ${id}`, max_persons: Math.max(0, ...occupancies) || 2, occupancies, price_1: null, pricing: "OBP" as const, parent_rate_id: "", readonly: false, ...extra,
});
const obp: BookingMappingDetails = { pricing_type: "OBP", rooms: [{ id: 586818903, title: "Double Room", max_children: 0, rates: [rate(16385046, [1, 2]), rate(16385047, [1, 2])] }] };
const perPerson = new Map([["plan-a", [{ channexId: "opt-a1", occupancy: 1 }, { channexId: "opt-a2", occupancy: 2 }]]]);

describe("Booking.com-Zuordnung", () => {
  it("OBP: ein Eintrag je Belegung, höchste Belegung primär (wie Leitfaden-Beispiel)", () => {
    const items = buildBookingMappings(obp, { [pairKey(586818903, 16385046)]: "plan-a" }, perPerson);
    expect(items).toEqual([
      { rate_plan_id: "opt-a1", settings: { room_type_code: 586818903, rate_plan_code: 16385046, occupancy: 1, pricing_type: "OBP", primary_occ: false, readonly: false } },
      { rate_plan_id: "opt-a2", settings: { room_type_code: 586818903, rate_plan_code: 16385046, occupancy: 2, pricing_type: "OBP", primary_occ: true, readonly: false } },
    ]);
  });

  it("OBP: Tarif mit nur einer Belegung wird nur für diese zugeordnet", () => {
    const perRoom = new Map([["plan-b", [{ channexId: "opt-b2", occupancy: 2 }]]]);
    const items = buildBookingMappings(obp, { [pairKey(586818903, 16385047)]: "plan-b" }, perRoom);
    expect(items).toHaveLength(1);
    expect(items[0].settings).toMatchObject({ occupancy: 2, primary_occ: true });
  });

  it("OBP: keine passende Belegung → verständlicher Fehler", () => {
    const single = new Map([["plan-c", [{ channexId: "opt-c3", occupancy: 3 }]]]);
    expect(() => buildBookingMappings(obp, { [pairKey(586818903, 16385046)]: "plan-c" }, single, new Map([["plan-c", "Suite – BAR"]]))).toThrow(/Suite – BAR/);
  });

  it("Standard: ein primärer Eintrag je Tarif", () => {
    const std: BookingMappingDetails = { pricing_type: "Standard", rooms: [{ id: 1, title: "Twin", max_children: null, rates: [rate(10, [], { pricing: "Standard", max_persons: 2 })] }] };
    const items = buildBookingMappings(std, { "1:10": "plan-a" }, perPerson);
    expect(items).toEqual([{ rate_plan_id: "opt-a2", settings: { room_type_code: 1, rate_plan_code: 10, occupancy: 2, pricing_type: "Standard", primary_occ: true, readonly: false } }]);
  });

  it("nichts zugeordnet oder Tarif ohne Channex-ID → Fehler", () => {
    expect(() => buildBookingMappings(obp, {}, perPerson)).toThrow(MappingError);
    expect(() => buildBookingMappings(obp, { "586818903:16385046": "unbekannt" }, perPerson)).toThrow(/nicht in Channex/);
  });
});
