import { describe, expect, it } from "vitest";
import { bearer, folioItemRequest, sameItem } from "../../src/domain/posbridge";

const ok = { room_number: "12", description: "Abendessen", unit_price_rappen: 4850, external_id: "K-1" };
describe("PosBridge Anfrage (SPEC 19.15)", () => {
  it("gültig mit Standardwerten", () => {
    const r = folioItemRequest.parse(ok);
    expect(r.quantity).toBe(1);
    expect(r.vat).toBe("standard");
  });
  it("genau eines von Zimmer oder Buchung", () => {
    expect(folioItemRequest.safeParse({ ...ok, booking_reference: "PNT-ABC123" }).success).toBe(false);
    expect(folioItemRequest.safeParse({ ...ok, room_number: undefined }).success).toBe(false);
    expect(folioItemRequest.safeParse({ ...ok, room_number: undefined, booking_reference: "PNT-ABC123" }).success).toBe(true);
  });
  it("Beträge nur ganze Rappen, Menge nicht 0, Beleg-ID Pflicht", () => {
    expect(folioItemRequest.safeParse({ ...ok, unit_price_rappen: 48.5 }).success).toBe(false);
    expect(folioItemRequest.safeParse({ ...ok, quantity: 0 }).success).toBe(false);
    expect(folioItemRequest.safeParse({ ...ok, external_id: "" }).success).toBe(false);
    expect(folioItemRequest.safeParse({ ...ok, vat: "x" }).success).toBe(false);
    expect(folioItemRequest.safeParse({ ...ok, unit_price_rappen: -500 }).success).toBe(true); // Gutschrift
  });
  it("Bearer-Schlüssel lesen", () => {
    expect(bearer("Bearer pnt_abc")).toBe("pnt_abc");
    expect(bearer("bearer pnt_abc")).toBe("pnt_abc");
    expect(bearer("Bearer abc")).toBeNull();
    expect(bearer("Basic pnt_abc")).toBeNull();
    expect(bearer(null)).toBeNull();
  });
  it("gleicher Inhalt", () => {
    const a = { description: "X", quantity: 1, unitPriceRappen: 100, vatKind: "standard" };
    expect(sameItem(a, { ...a })).toBe(true);
    expect(sameItem(a, { ...a, unitPriceRappen: 101 })).toBe(false);
  });
});
