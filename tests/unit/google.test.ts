import { describe, expect, it } from "vitest";
import { actionFeed, entityFeed, feedDescriptor, googleLinks, listingChecklist, parseReferrer, type FeedEntity } from "../../src/domain/google";

describe("Google (SPEC 19.67)", () => {
  it("Herkunft nur aus fester Liste", () => {
    expect(parseReferrer("google")).toBe("google");
    expect(parseReferrer("evil")).toBeNull();
    expect(parseReferrer(undefined)).toBeNull();
  });
  it("Links mit Herkunft; Buchungslink mit Channex-Platzhaltern nur für Unterkünfte", () => {
    const h = googleLinks({ base: "https://hotel.ch", lang: "de", lodging: true, reserve: false, order: false });
    expect(h.book).toBe("https://hotel.ch/de/book?ref=google");
    expect(h.bookTemplate).toBe("https://hotel.ch/de/book?checkin=(CHECKIN_DATE)&checkout=(CHECKOUT_DATE)&adults=(ADULTS)&ref=google");
    expect(h.reserve).toBeNull();
    const r = googleLinks({ base: "https://pontivo.ch/h/roessli", lang: "fr", lodging: false, reserve: true, order: true });
    expect(r.book).toBeNull();
    expect(r.reserve).toBe("https://pontivo.ch/h/roessli/fr/tisch?ref=google");
    expect(r.order).toBe("https://pontivo.ch/h/roessli/fr/bestellen?ref=google");
  });
  it("Prüfliste zeigt, was fehlt", () => {
    const all = { address: true, phone: true, coordinates: true, photo: true, description: true, cancellation: true, live: true, channex: true };
    expect(listingChecklist(all).every((c) => c.ok)).toBe(true);
    expect(listingChecklist({ ...all, coordinates: false }).filter((c) => !c.ok).map((c) => c.key)).toEqual(["coordinates"]);
  });
  it("Feeds für das Actions Center", () => {
    const e: FeedEntity = { id: "h1", name: "Rössli", phone: "+41711234567", url: "https://x/de", lat: 47.4, lng: 9.3, street: "Marktgasse 5", city: "St. Gallen", postalCode: "9000", country: "CH", reserveUrl: "https://x/de/tisch?ref=google", orderUrl: "https://x/de/bestellen?ref=google", delivery: false, takeout: true };
    const ent = entityFeed([e]);
    expect(ent.data[0]).toMatchObject({ entity_id: "h1", name: "Rössli", telephone: "+41711234567", location: { latitude: 47.4, longitude: 9.3 } });
    const act = actionFeed([e]);
    expect(act.data).toHaveLength(2);
    expect(act.data[0].actions).toEqual([{ dining_info: { dining_type: "TABLE_RESERVATION" } }]);
    expect(act.data[1].actions).toEqual([{ food_ordering_info: { service_type: "TAKEOUT" } }]);
    expect(feedDescriptor("reservewithgoogle.entity", 1700000000, ["entity_1700000000.json"])).toEqual({ generation_timestamp: 1700000000, name: "reservewithgoogle.entity", data_file: ["entity_1700000000.json"] });
  });
});
