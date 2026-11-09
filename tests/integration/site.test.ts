import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { roomTypes, sitePages } from "../../src/db/schema";
import {
  addBlock, addDocument, createImprintPage, createPage, deleteBlock, deletePage, documentLibrary, ensureHomePage, getPublicPage, listPages, moveBlock, movePage, navPages, removeDocument, SiteError, updateBlock, updatePageMeta,
} from "../../src/services/site";
import { updateDesign } from "../../src/services/brand";
import { hotels } from "../../src/db/schema";
import { slugify, tr, paragraphs } from "../../src/domain/blocks";
import { searchOffers } from "../../src/services/search";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const meta = (o: Partial<Parameters<typeof updatePageMeta>[2]> = {}) => ({
  title: { de: "Restaurant", en: "Restaurant" }, navLabel: {}, slug: "restaurant", showInNav: true, published: true, seo: { de: {}, en: {} }, ...o,
});

describe("Website-Editor", () => {
  it("Startseite wird einmal angelegt, mit Titel und Zimmern", async () => {
    const h = await makeHotel();
    const p1 = await ensureHomePage(h.hotel, "t");
    const p2 = await ensureHomePage(h.hotel, "t");
    expect(p1.id).toBe(p2.id);
    expect(p1.slug).toBe("");
    expect(p1.blocks.map((b) => b.type)).toEqual(["hero", "rooms"]);
    expect(await getPublicPage(h.hotel.id, "")).not.toBeNull();
  });

  it("Seiten anlegen, Adresse eindeutig, reservierte Adressen gesperrt, Menü-Reihenfolge", async () => {
    const h = await makeHotel();
    const a = await createPage(h.hotel.id, "Restaurant & Bar", "t");
    expect(a.slug).toBe("restaurant-bar");
    const b = await createPage(h.hotel.id, "Restaurant & Bar", "t");
    expect(b.slug).toBe("restaurant-bar-2");
    const c = await createPage(h.hotel.id, "Book", "t");
    expect(c.slug).toBe("book-seite");
    await expect(updatePageMeta(h.hotel.id, b.id, meta({ slug: "agb" }), "t")).rejects.toThrow(/reserviert/);
    await expect(updatePageMeta(h.hotel.id, b.id, meta({ slug: "restaurant-bar" }), "t")).rejects.toThrow(/gibt es schon/);
    await updatePageMeta(h.hotel.id, b.id, meta({ slug: "Seminar Räume" }), "t");
    expect((await listPages(h.hotel.id)).find((p) => p.id === b.id)?.slug).toBe("seminar-raeume");
    expect((await navPages(h.hotel.id)).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
    await movePage(h.hotel.id, c.id, -1, "t");
    expect((await navPages(h.hotel.id)).map((p) => p.id)).toEqual([a.id, c.id, b.id]);
    await updatePageMeta(h.hotel.id, c.id, meta({ slug: "book-seite", published: false }), "t");
    expect(await getPublicPage(h.hotel.id, "book-seite")).toBeNull();
    await deletePage(h.hotel.id, a.id, "t");
    const home = await ensureHomePage(h.hotel, "t");
    await expect(deletePage(h.hotel.id, home.id, "t")).rejects.toBeInstanceOf(SiteError);
  });

  it("Bausteine hinzufügen, bearbeiten, verschieben, löschen; Validierung", async () => {
    const h = await makeHotel();
    const p = await createPage(h.hotel.id, "Restaurant", "t");
    const id = await addBlock(h.hotel.id, p.id, "facts", "t");
    await updateBlock(h.hotel.id, p.id, id, { id, type: "facts", heading: { de: "Öffnungszeiten", en: "Opening hours" }, items: [{ label: { de: "Mittag" }, value: { de: "11.30–14.00" } }] }, "t");
    let [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    expect(row.blocks.map((b) => b.type)).toEqual(["text", "facts"]);
    expect(row.blocks[1]).toMatchObject({ heading: { en: "Opening hours" }, items: [{ label: { de: "Mittag" } }] });
    await moveBlock(h.hotel.id, p.id, id, -1, "t");
    [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    expect(row.blocks[0].id).toBe(id);
    // Typ wechseln oder fremde Bilder → abgelehnt
    await expect(updateBlock(h.hotel.id, p.id, id, { id, type: "text", heading: {}, body: {} }, "t")).rejects.toThrow(/Bausteintyp/);
    const other = "00000000-0000-0000-0000-000000000000";
    const gid = await addBlock(h.hotel.id, p.id, "gallery", "t");
    await expect(updateBlock(h.hotel.id, p.id, gid, { id: gid, type: "gallery", heading: {}, images: [{ url: `/media/${other}/abcdefghijklmnop.png` }] }, "t")).rejects.toThrow(/gehört nicht/);
    await expect(updateBlock(h.hotel.id, p.id, gid, { id: gid, type: "gallery", heading: {}, images: [{ url: "https://evil.example/x.png" }] }, "t")).rejects.toThrow();
    await updateBlock(h.hotel.id, p.id, gid, { id: gid, type: "gallery", heading: {}, images: [{ url: `/media/${h.hotel.id}/abcdefghijklmnop.png` }] }, "t");
    await deleteBlock(h.hotel.id, p.id, gid, "t");
    [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    expect(row.blocks).toHaveLength(2);
  });

  it("Mandantentrennung", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const p = await createPage(b.hotel.id, "Geheim", "t");
    await expect(updatePageMeta(a.hotel.id, p.id, meta(), "t")).rejects.toBeInstanceOf(SiteError);
    await expect(addBlock(a.hotel.id, p.id, "text", "t")).rejects.toBeInstanceOf(SiteError);
    await expect(deletePage(a.hotel.id, p.id, "t")).rejects.toBeInstanceOf(SiteError);
    expect(await getPublicPage(a.hotel.id, p.slug)).toBeNull();
  });

  it("Impressum wird vorbefüllt und ist nicht im Menü", async () => {
    const h = await makeHotel();
    const p = await createImprintPage(h.hotel, "t");
    expect(p.slug).toBe("impressum");
    const [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    expect(row.showInNav).toBe(false);
    const body = row.blocks[0].type === "text" ? tr(row.blocks[0].body, "de") : "";
    expect(body).toContain(h.hotel.contactEmail);
    expect(body).toContain("UID");
  });

  it("Englische Zimmernamen in der Suche", async () => {
    const h = await makeHotel();
    await db().update(roomTypes).set({ i18n: { en: { name: "Double room" } } }).where(eq(roomTypes.id, h.rooms[0].roomType.id));
    const d = inDays(9);
    const en = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0 }, { lang: "en" });
    const de = await searchOffers(h.hotel, { checkin: d, checkout: addDays(d, 1), adults: 2, children: 0 }, { lang: "de" });
    expect(en.ok && en.offers[0].roomType.name).toBe("Double room");
    expect(de.ok && de.offers[0].roomType.name).toBe("Doppelzimmer");
  });

  it("Hilfsfunktionen", () => {
    expect(slugify("Lage & Anreise")).toBe("lage-anreise");
    expect(slugify("Über uns")).toBe("ueber-uns");
    expect(tr({ de: "Hallo" }, "en")).toBe("Hallo");
    expect(paragraphs("a\nb\n\nc")).toEqual([["a", "b"], ["c"]]);
  });
});

describe("Gestaltung und Dokumente", () => {
  it("Layout und Schrift speichern, ungültige Werte abgelehnt, Farbe/Logo bleiben", async () => {
    const h = await makeHotel();
    await db().update(hotels).set({ content: { ...h.hotel.content, brand: { color: "#2f5d50", mode: "website" } } }).where(eq(hotels.id, h.hotel.id));
    await updateDesign(h.hotel.id, { layout: "panorama", font: "elegant" }, "t");
    const [x] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    expect(x.content.brand).toMatchObject({ layout: "panorama", font: "elegant", color: "#2f5d50", mode: "website" });
    await expect(updateDesign(h.hotel.id, { layout: "wild" as never, font: "elegant" }, "t")).rejects.toThrow();
  });

  it("Dokumente: hinzufügen, Titel nötig, entfernen, Mandantentrennung", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const url = `/media/${a.hotel.id}/abcdefghijklmnopqr.pdf`;
    await expect(addDocument(a.hotel.id, { url, title: {}, bytes: 100 }, "t")).rejects.toThrow(/Titel/);
    await addDocument(a.hotel.id, { url, title: { de: " Speisekarte ", en: "Menu" }, bytes: 2048 }, "t");
    const [ha] = await db().select().from(hotels).where(eq(hotels.id, a.hotel.id));
    expect(documentLibrary(ha)).toEqual([{ url, title: { de: "Speisekarte", en: "Menu" }, bytes: 2048 }]);
    await expect(removeDocument(b.hotel.id, url, "t")).rejects.toBeInstanceOf(SiteError);
    expect(await removeDocument(a.hotel.id, url, "t")).toBe(url);
    const [ha2] = await db().select().from(hotels).where(eq(hotels.id, a.hotel.id));
    expect(documentLibrary(ha2)).toEqual([]);
  });

  it("Baustein Downloads und Formatierung werden gespeichert", async () => {
    const h = await makeHotel();
    const p = await createPage(h.hotel.id, "Restaurant", "t");
    const id = await addBlock(h.hotel.id, p.id, "downloads", "t");
    const url = `/media/${h.hotel.id}/abcdefghijklmnopqr.pdf`;
    await updateBlock(h.hotel.id, p.id, id, { id, type: "downloads", heading: { de: "Karten" }, files: [url] }, "t");
    const tid = p.blocks[0].id;
    await updateBlock(h.hotel.id, p.id, tid, { id: tid, type: "text", heading: {}, body: { de: "**Neu:** Fondue" }, align: "center", size: "large" }, "t");
    const [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    expect(row.blocks.find((b) => b.id === id)).toMatchObject({ type: "downloads", files: [url] });
    expect(row.blocks.find((b) => b.id === tid)).toMatchObject({ align: "center", size: "large", body: { de: "**Neu:** Fondue" } });
  });
});
