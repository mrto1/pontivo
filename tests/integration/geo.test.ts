import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels, sitePages } from "../../src/db/schema";
import { llmsTxt, robotsTxt, sitemapXml } from "../../src/services/geo";
import { hotelJsonLd, ldJson } from "../../src/lib/structured-data";
import { pageMetadata } from "../../src/lib/page-meta";
import { makeHotel } from "../helpers";

afterAll(() => closeDb());

async function setup() {
  const h = await makeHotel();
  await db().update(hotels).set({ content: { languages: ["de", "en"], de: { intro: "Kleines Familienhotel am See." } }, contactPhone: "+41 41 000 00 00", addressLine: "Seestrasse 1", postalCode: "6000", city: "Luzern" }).where(eq(hotels.id, h.hotel.id));
  await db().insert(sitePages).values({
    hotelId: h.hotel.id, slug: "", title: { de: "Start", en: "Home" }, sortOrder: 0,
    blocks: [
      { id: "f", type: "faq", heading: { de: "FAQ" }, items: [{ q: { de: "Sind Hunde erlaubt?" }, a: { de: "Ja, gegen Aufpreis." } }] },
      { id: "x", type: "facts", heading: { de: "Fakten" }, items: [{ label: { de: "Parkplatz" }, value: { de: "gratis" } }] },
    ] as never,
  });
  await db().insert(sitePages).values({ hotelId: h.hotel.id, slug: "geheim", title: { de: "Geheim" }, published: false, blocks: [] as never });
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  return { ...h, hotel };
}

describe("GEO (SPEC 14e)", () => {
  it("llms.txt: Fakten, Zimmer, FAQ, Buchungslink – nur veröffentlichte Seiten", async () => {
    const { hotel, rooms } = await setup();
    const t = await llmsTxt(hotel);
    expect(t).toMatch(/^# /);
    expect(t).toContain("Kleines Familienhotel am See.");
    expect(t).toContain("Seestrasse 1, 6000 Luzern");
    expect(t).toContain("+41 41 000 00 00");
    expect(t).toContain("Parkplatz: gratis");
    expect(t).toContain("Sind Hunde erlaubt?");
    expect(t).toContain(rooms[0].roomType.name);
    expect(t).toMatch(/ab CHF \d+ pro Nacht/);
    expect(t).toContain("/de/book");
    expect(t).not.toContain("geheim");
    expect(t).not.toContain("Geheim");
  });

  it("sitemap.xml: jede Sprache mit hreflang, unveröffentlichte Seiten fehlen", async () => {
    const { hotel } = await setup();
    const x = await sitemapXml(hotel);
    expect(x).toContain("<urlset");
    expect((x.match(/<url>/g) ?? []).length).toBe(2); // Startseite × de, en
    expect(x).toContain('hreflang="en"');
    expect(x).toContain('hreflang="x-default"');
    expect(x).not.toContain("geheim");
  });

  it("robots.txt: Verwaltung und persönliche Links gesperrt, Sitemap nur mit Hotel", async () => {
    const { hotel } = await setup();
    const r = robotsTxt(hotel);
    expect(r).toContain("Disallow: /admin");
    expect(r).toContain("Disallow: /b/");
    expect(r).toContain("Sitemap:");
    expect(robotsTxt(null)).not.toContain("Sitemap:");
  });

  it("Strukturdaten: Zimmer und Buchungsaktion; canonical in den Metadaten", async () => {
    const { hotel, rooms } = await setup();
    const ld = (await hotelJsonLd(hotel, "de", "https://example.ch", [])) as Record<string, unknown>;
    const places = ld.containsPlace as { "@type": string; name: string; occupancy: { maxValue: number } }[];
    expect(places[0]).toMatchObject({ "@type": "HotelRoom", name: rooms[0].roomType.name });
    expect((ld.potentialAction as { target: { urlTemplate: string } }).target.urlTemplate).toBe("https://example.ch/de/book");
    expect(ldJson(ld)).not.toContain("<");
    const meta = pageMetadata(hotel, null, "de");
    expect(meta.alternates?.canonical).toMatch(/\/de$/);
  });
});
