import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { hotels, ratePlans, roomTypes, sitePages } from "../../src/db/schema";
import { addBlock, createPage, updateBlock } from "../../src/services/site";
import { updateLanguages } from "../../src/services/brand";
import { setTranslateFetch, translatePage, translateRooms, translationsLeft, TranslateError } from "../../src/services/translate";
import { fallbackChain, hotelLocales, LOCALES, t } from "../../src/i18n/dict";
import { tr } from "../../src/domain/blocks";
import { roomName } from "../../src/domain/i18n-names";
import { cancellationPolicyText } from "../../src/domain/cancellation";
import { render } from "../../src/email/templates";
import { makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => {
  setTranslateFetch(null);
  delete process.env.ANTHROPIC_API_KEY;
});

/** Simulierter Claude-Aufruf: "übersetzt" jeden Text als "[xx] Text" und merkt sich die Anfragen */
function fakeClaude() {
  const calls: { model: string; user: string }[] = [];
  setTranslateFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const user: string = body.messages[0].content;
    calls.push({ model: body.model, user });
    const langs = [...user.matchAll(/\b(en|fr|it|nl) \(/g)].map((m) => m[1]);
    const texts = JSON.parse(user.slice(user.indexOf("{")));
    const out = Object.fromEntries(langs.map((l) => [l, Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, `[${l}] ${v}`]))]));
    return { status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }) };
  });
  process.env.ANTHROPIC_API_KEY = "test-key";
  return calls;
}

const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];

describe("Sprachen", () => {
  it("Wörterbuch vollständig in allen Sprachen", () => {
    const keys = Object.keys(t("de"));
    for (const l of LOCALES) {
      const d = t(l) as Record<string, string>;
      for (const k of keys) if (k !== "legalInEnglish") expect(d[k], `${l}.${k}`).toBeTruthy();
    }
  });

  it("Rückfall: gewünschte Sprache, dann Englisch, dann Deutsch", () => {
    expect(fallbackChain("fr")).toEqual(["fr", "en", "de"]);
    expect(tr({ de: "Zimmer", en: "Rooms" }, "it")).toBe("Rooms");
    expect(tr({ de: "Zimmer" }, "nl")).toBe("Zimmer");
    expect(tr({ de: "Zimmer", fr: "Chambres" }, "fr")).toBe("Chambres");
    expect(roomName({ name: "Doppelzimmer", i18n: { en: { name: "Double room" } } }, "it")).toBe("Double room");
    expect(roomName({ name: "Doppelzimmer", i18n: { it: { name: "Camera doppia" } } }, "it")).toBe("Camera doppia");
  });

  it("Sprachen pro Hotel: Deutsch immer dabei, Standard DE/EN", async () => {
    const h = await makeHotel();
    expect(hotelLocales(h.hotel)).toEqual(["de", "en"]);
    expect(await updateLanguages(h.hotel.id, ["fr", "it"], "t")).toEqual(["de", "fr", "it"]);
    expect(hotelLocales(await fresh(h.hotel.id))).toEqual(["de", "fr", "it"]);
    await expect(updateLanguages(h.hotel.id, ["xx"], "t")).rejects.toThrow();
  });

  it("Storno-Text und Gäste-Mail auf Französisch, Hotel-Mail auf DE/EN", async () => {
    expect(cancellationPolicyText({ freeCancelHours: 48, cancelFeeBps: 10000 }, "fr")).toBe("Annulation gratuite jusqu'à 2 jour(s) avant l'arrivée (heure d'arrivée). Ensuite, 100 % du prix de la chambre.");
    const h = await makeHotel();
    const r = render("post_stay", "fr", { hotel: h.hotel, guestName: "Marie", data: {}, baseUrl: "https://x" });
    expect(r.subject).toContain("Merci de votre visite");
    expect(r.text).toContain("Bonjour Marie");
    expect(r.html).toContain('lang="fr"');
    expect(render("login_link", "it", { hotel: h.hotel, data: { link: "https://x" }, baseUrl: "https://x" }).subject).toBe("Your login link");
  });
});

describe("Automatische Übersetzung", () => {
  it("ohne Schlüssel nicht verfügbar", async () => {
    const h = await makeHotel();
    await updateLanguages(h.hotel.id, ["en", "fr"], "t");
    const p = await createPage(h.hotel.id, "Restaurant", "t");
    await expect(translatePage(await fresh(h.hotel.id), p.id, "missing", "t")).rejects.toBeInstanceOf(TranslateError);
  });

  it("Seite: nur leere Felder, Formatierung bleibt, ein Aufruf, zählt ans Limit", async () => {
    const calls = fakeClaude();
    const h = await makeHotel();
    await updateLanguages(h.hotel.id, ["en", "fr"], "t");
    const p = await createPage(h.hotel.id, "Restaurant", "t");
    const tid = p.blocks[0].id;
    await updateBlock(h.hotel.id, p.id, tid, { id: tid, type: "text", heading: { de: "Willkommen", en: "Welcome!" }, body: { de: "**Fondue** im Winter" } }, "t");
    const fid = await addBlock(h.hotel.id, p.id, "facts", "t");
    await updateBlock(h.hotel.id, p.id, fid, { id: fid, type: "facts", heading: {}, items: [{ label: { de: "Mittag" }, value: { de: "11.30–14.00 Uhr" } }] }, "t");
    const before = translationsLeft(await fresh(h.hotel.id));
    const n = await translatePage(await fresh(h.hotel.id), p.id, "missing", "t");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("claude-sonnet-5-5");
    expect(n).toBeGreaterThan(0);
    const [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    const text = row.blocks.find((b) => b.id === tid) as any;
    expect(text.heading).toEqual({ de: "Willkommen", en: "Welcome!", fr: "[fr] Willkommen" }); // eigene EN-Übersetzung bleibt
    expect(text.body.fr).toBe("[fr] **Fondue** im Winter");
    const facts = row.blocks.find((b) => b.id === fid) as any;
    expect(facts.items[0].label.en).toBe("[en] Mittag");
    expect(row.title.fr).toBe("[fr] Restaurant");
    expect(translationsLeft(await fresh(h.hotel.id))).toBe(before - 1);
    // nichts mehr zu tun → kein Aufruf, zählt nicht
    expect(await translatePage(await fresh(h.hotel.id), p.id, "missing", "t")).toBe(0);
    expect(calls).toHaveLength(1);
    expect(translationsLeft(await fresh(h.hotel.id))).toBe(before - 1);
    // alles neu: überschreibt auch die eigene EN-Übersetzung
    await translatePage(await fresh(h.hotel.id), p.id, "all", "t", { blockId: tid, lang: "en" });
    const [row2] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    expect((row2.blocks.find((b) => b.id === tid) as any).heading.en).toBe("[en] Willkommen");
  });

  it("Monatslimit", async () => {
    fakeClaude();
    process.env.TRANSLATIONS_PER_MONTH = "1";
    try {
      const h = await makeHotel();
      await updateLanguages(h.hotel.id, ["en"], "t");
      const a = await createPage(h.hotel.id, "Restaurant", "t");
      const b = await createPage(h.hotel.id, "Seminare", "t");
      await translatePage(await fresh(h.hotel.id), a.id, "missing", "t");
      await expect(translatePage(await fresh(h.hotel.id), b.id, "missing", "t")).rejects.toThrow(/Monatslimit/);
    } finally {
      delete process.env.TRANSLATIONS_PER_MONTH;
    }
  });

  it("Zimmer und Tarife", async () => {
    fakeClaude();
    const h = await makeHotel();
    await updateLanguages(h.hotel.id, ["en", "it"], "t");
    const n = await translateRooms(await fresh(h.hotel.id), "t");
    expect(n).toBeGreaterThan(0);
    const [rt] = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, h.hotel.id));
    expect(rt.i18n.it?.name).toBe(`[it] ${rt.name}`);
    const [rp] = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, h.hotel.id));
    expect(rp.i18n.en?.name).toBe(`[en] ${rp.name}`);
  });

  it("unlesbare Antwort → Fehler, nichts gespeichert, zählt nicht", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    setTranslateFetch(async () => ({ status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: "Sorry" }] }) }));
    const h = await makeHotel();
    await updateLanguages(h.hotel.id, ["en"], "t");
    const p = await createPage(h.hotel.id, "Restaurant", "t");
    const before = translationsLeft(await fresh(h.hotel.id));
    await expect(translatePage(await fresh(h.hotel.id), p.id, "missing", "t")).rejects.toBeInstanceOf(TranslateError);
    expect(translationsLeft(await fresh(h.hotel.id))).toBe(before);
  });
});
