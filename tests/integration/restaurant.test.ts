import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { emailOutbox, hotels, inquiries, sitePages } from "../../src/db/schema";
import { POST as inquiryPost } from "../../app/api/inquiry/route";
import { createInquiry } from "../../src/services/inquiries";
import { addBlock, createPage, updateBlock } from "../../src/services/site";
import { updateLanguages } from "../../src/services/brand";
import { setTranslateFetch, translatePage } from "../../src/services/translate";
import { hotelKnowledge } from "../../src/services/knowledge";
import { restaurantJsonLd } from "../../src/lib/structured-data";
import { groupDays, menuSections } from "../../src/domain/blocks";
import { render } from "../../src/email/templates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => {
  setTranslateFetch(null);
  delete process.env.ANTHROPIC_API_KEY;
});
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const r = (from: string, to: string) => ({ from, to });
const WEEK = [[r("11:30", "14:00"), r("18:00", "22:00")], [], [r("11:30", "14:00"), r("18:00", "22:00")], [r("11:30", "14:00"), r("18:00", "22:00")], [r("11:30", "14:00"), r("18:00", "23:30")], [r("11:30", "23:30")], [r("11:30", "21:00")]];

describe("Restaurant: Speisekarte, Öffnungszeiten, Tischreservation", () => {
  it("Gleiche Tage werden zusammengefasst, Rubriken gruppiert", () => {
    expect(groupDays(WEEK).map((g) => [g.first, g.last, g.ranges.length])).toEqual([[0, 0, 2], [1, 1, 0], [2, 3, 2], [4, 4, 2], [5, 5, 1], [6, 6, 1]]);
    const items = [{ section: { de: "Vorspeisen" }, n: 1 }, { section: { de: "Vorspeisen" }, n: 2 }, { section: { de: "Hauptgänge" }, n: 3 }];
    expect(menuSections(items).map((s) => [s.section.de, s.items.length])).toEqual([["Vorspeisen", 2], ["Hauptgänge", 1]]);
  });

  it("Bausteine speichern, prüfen Zeiten; JSON-LD Restaurant mit Menü und Ferien; Übersetzung und KI-Wissen", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    setTranslateFetch(async (_u, init) => {
      const user: string = JSON.parse(init.body).messages[0].content;
      const texts = JSON.parse(user.slice(user.indexOf("{")));
      const out = { en: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, `EN ${v}`])) };
      return { status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }) };
    });
    const h = await makeHotel();
    await updateLanguages(h.hotel.id, ["en"], "t");
    const p = await createPage(h.hotel.id, "Restaurant", "t");
    const mid = await addBlock(h.hotel.id, p.id, "menu", "t");
    await updateBlock(h.hotel.id, p.id, mid, {
      id: mid, type: "menu", heading: { de: "Speisekarte" }, intro: {}, note: { de: "Rind: Schweiz" },
      items: [
        { section: { de: "Vorspeisen" }, name: { de: "Nüsslisalat" }, text: { de: "mit Ei und Speck" }, priceRappen: 1450, diet: "", glutenFree: true },
        { section: { de: "Hauptgänge" }, name: { de: "Glarner Chalberwurst" }, text: {}, priceRappen: 2850 },
        { section: { de: "Hauptgänge" }, name: { de: "Älplermagronen" }, text: {}, priceRappen: 2400, diet: "vegetarian" },
      ],
    }, "t");
    const hid = await addBlock(h.hotel.id, p.id, "hours", "t");
    // Zeitfenster ohne Ende wird abgelehnt
    await expect(updateBlock(h.hotel.id, p.id, hid, { id: hid, type: "hours", heading: {}, days: [[{ from: "11:30", to: "" }], [], [], [], [], [], []] }, "t")).rejects.toThrow();
    // nur 6 Tage → abgelehnt
    await expect(updateBlock(h.hotel.id, p.id, hid, { id: hid, type: "hours", heading: {}, days: WEEK.slice(0, 6) }, "t")).rejects.toThrow();
    await updateBlock(h.hotel.id, p.id, hid, {
      id: hid, type: "hours", heading: { de: "Öffnungszeiten" }, place: "restaurant", days: WEEK, note: {},
      closures: [{ from: inDays(30), to: inDays(50), label: { de: "Winterpause" } }, { from: inDays(-60), to: inDays(-40), label: {} }],
    }, "t");

    const [page] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    const ld = restaurantJsonLd(await fresh(h.hotel.id), page.blocks, "de", "https://hotel.test/de/restaurant") as any;
    expect(ld["@type"]).toBe("Restaurant");
    expect(ld.openingHoursSpecification).toHaveLength(10); // Mo, Mi–Fr je 2, Di geschlossen, Sa/So je 1
    expect(ld.openingHoursSpecification[0]).toEqual({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Monday", opens: "11:30", closes: "14:00" });
    expect(ld.specialOpeningHoursSpecification).toEqual([{ "@type": "OpeningHoursSpecification", opens: "00:00", closes: "00:00", validFrom: inDays(30), validThrough: inDays(50) }]);
    expect(ld.hasMenu.hasMenuSection.map((s: any) => s.name)).toEqual(["Vorspeisen", "Hauptgänge"]);
    expect(ld.hasMenu.hasMenuSection[1].hasMenuItem[1]).toMatchObject({ name: "Älplermagronen", offers: { price: "24.00", priceCurrency: "CHF" }, suitableForDiet: "https://schema.org/VegetarianDiet" });
    // Seite ohne Restaurant-Bausteine: kein Restaurant-Markup
    expect(restaurantJsonLd(await fresh(h.hotel.id), [], "de", "https://hotel.test")).toBeNull();

    await translatePage(await fresh(h.hotel.id), p.id, "missing", "t");
    const k = await hotelKnowledge(await fresh(h.hotel.id), "en");
    expect(k.menu[0]).toEqual({ section: "EN Vorspeisen", name: "EN Nüsslisalat", text: "EN mit Ei und Speck", priceChf: "14.50", diet: "", glutenFree: true });
    expect(k.hours[0].days[1]).toEqual([]);
    expect(k.hours[0].closures[0].label).toBe("EN Winterpause");
  });

  it("Tischreservation: Datum, Uhrzeit und Personen nötig; Gast erhält Bestätigung «gilt nach Bestätigung»", async () => {
    const h = await makeHotel();
    await expect(createInquiry(h.hotel, { kind: "table", name: "Hans", email: "hans@example.ch", dateFrom: inDays(3), persons: 4 })).rejects.toThrow();
    await expect(createInquiry(h.hotel, { kind: "table", name: "Hans", email: "hans@example.ch", dateFrom: inDays(3), timeOfDay: "25:00", persons: 4 })).rejects.toThrow();

    const res = await inquiryPost(new Request("http://localhost/api/inquiry", { method: "POST", body: form({
      hotel: h.hotel.slug, lang: "de", back: "/h/x/de/restaurant", kind: "table", name: "Hans Muster", email: "hans@example.ch", persons: "4", dateFrom: inDays(3), time: "19:30", message: "Fensterplatz", page: "restaurant",
    }) }));
    expect(res.headers.get("location")).toBe("http://localhost/h/x/de/restaurant#anfrage-gesendet");
    const [q] = await db().select().from(inquiries).where(eq(inquiries.hotelId, h.hotel.id));
    expect(q).toMatchObject({ kind: "table", timeOfDay: "19:30", persons: 4, dateFrom: inDays(3) });

    const [mail] = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.hotel.id), eq(emailOutbox.template, "inquiry_confirmation")));
    const out = render("inquiry_confirmation", "de", { hotel: await fresh(h.hotel.id), data: mail.data as Record<string, unknown>, baseUrl: "https://x" });
    expect(out.subject).toContain("Tischreservation");
    expect(out.text).toContain("sobald wir sie bestätigt haben");
    expect(out.text).toContain("Uhrzeit: 19:30");
    const [hm] = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.hotel.id), eq(emailOutbox.template, "inquiry_received")));
    expect(render("inquiry_received", "de", { hotel: await fresh(h.hotel.id), data: hm.data as Record<string, unknown>, baseUrl: "https://x" }).text).toContain("Uhrzeit: 19:30");
  });
});
