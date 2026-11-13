import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { extras, hotels, ratePlans, roomTypes, sitePages, type Hotel } from "../db/schema";
import { blockSchema, type Block, type L } from "../domain/blocks";
import { hotelLocales, LOCALE_NAMES, LOCALES, type Locale } from "../i18n/dict";
import { env } from "../env";
import { audit } from "./audit";
import { getPage, SiteError } from "./site";

/**
 * Automatische Übersetzung der Hotel-Texte aus dem Deutschen (Claude API, Messages-Endpunkt).
 * Pontivo trägt die Kosten (in der Plattformgebühr enthalten); Limit pro Hotel und Monat (TRANSLATIONS_PER_MONTH).
 * Formatierungszeichen (src/domain/richtext.ts), Links, E-Mail, Telefon und Eigennamen bleiben erhalten.
 */

export class TranslateError extends Error {}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: () => Promise<string> }>;
let fetchOverride: FetchLike | null = null;
/** Für Tests: API-Aufrufe abfangen */
export function setTranslateFetch(f: FetchLike | null) {
  fetchOverride = f;
}

export function translationEnabled(): boolean {
  return !!env().ANTHROPIC_API_KEY;
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

export function translationsLeft(hotel: Hotel, now = new Date()): number {
  return Math.max(0, env().TRANSLATIONS_PER_MONTH - (hotel.content.translations?.[month(now)] ?? 0));
}

const SYSTEM = `You translate website texts of a small Swiss hotel from German into other languages.
Rules:
- Natural, warm hospitality tone for guests; formal address (Sie → vous / Lei or voi / u).
- Keep these exactly as they are: formatting marks ** * __ == , link syntax [text](url) (translate only the text in brackets, never the url), line breaks, list markers at line start ("- ", "1. ", "## "), e-mail addresses, phone numbers, web addresses, prices, times, dates.
- Do not translate proper names: the hotel name, place names, mountains, lakes, dish names that are local specialities (you may add a short explanation in brackets only if very helpful).
- Swiss conventions: no ß, prices as CHF.
- Return ONLY a JSON object: {"<language code>": {"<key>": "<translation>", ...}, ...} with exactly the requested languages and keys. No other text.`;

/** Texte (Schlüssel → Deutsch) in die Zielsprachen übersetzen. Ein Aufruf pro Anfrage. */
export async function translateTexts(texts: Record<string, string>, targets: Locale[], hotelName: string): Promise<Partial<Record<Locale, Record<string, string>>>> {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new TranslateError("Automatische Übersetzung ist nicht eingerichtet");
  const keys = Object.keys(texts);
  if (!keys.length || !targets.length) return {};
  const user = `Hotel name: ${hotelName}\nTarget languages: ${targets.map((l) => `${l} (${LOCALE_NAMES[l]})`).join(", ")}\n\nTexts (JSON, German):\n${JSON.stringify(texts, null, 1)}`;
  const f: FetchLike = fetchOverride ?? ((u, init) => fetch(u, init));
  let res;
  try {
    res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env().TRANSLATE_MODEL, max_tokens: 16000, system: SYSTEM, messages: [{ role: "user", content: user }] }),
    });
  } catch (e) {
    throw new TranslateError(`Übersetzungsdienst nicht erreichbar: ${(e as Error).message}`);
  }
  const body = await res.text();
  if (res.status < 200 || res.status >= 300) throw new TranslateError(`Übersetzungsdienst: HTTP ${res.status}`);
  let text = "";
  try {
    const j = JSON.parse(body) as { content?: { type: string; text?: string }[] };
    text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  } catch {
    throw new TranslateError("Übersetzungsdienst: unerwartete Antwort");
  }
  const m = /\{[\s\S]*\}/.exec(text);
  let parsed: Record<string, Record<string, unknown>>;
  try {
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    throw new TranslateError("Übersetzung konnte nicht gelesen werden – bitte nochmals versuchen");
  }
  const out: Partial<Record<Locale, Record<string, string>>> = {};
  for (const l of targets) {
    const r = parsed[l] ?? {};
    out[l] = Object.fromEntries(keys.filter((k) => typeof r[k] === "string" && (r[k] as string).trim()).map((k) => [k, String(r[k]).slice(0, Math.max(200, texts[k].length * 3))]));
  }
  return out;
}

/** Limit prüfen, übersetzen, Zähler erhöhen. Leere Arbeit zählt nicht. */
async function withQuota<T>(hotel: Hotel, work: () => Promise<T | null>, actor: string, what: string): Promise<T | null> {
  if (!translationEnabled()) throw new TranslateError("Automatische Übersetzung ist nicht eingerichtet");
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  if (translationsLeft(h) <= 0) throw new TranslateError(`Monatslimit erreicht (${env().TRANSLATIONS_PER_MONTH} Übersetzungen). Ab nächstem Monat wieder möglich, Felder können Sie jederzeit von Hand ausfüllen.`);
  const r = await work();
  if (r === null) return null;
  await db().transaction(async (tx) => {
    const [x] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
    const tr = { ...(x.content.translations ?? {}) };
    tr[month()] = (tr[month()] ?? 0) + 1;
    // nur die letzten 12 Monate behalten
    const keep = Object.keys(tr).sort().slice(-12);
    await tx.update(hotels).set({ content: { ...x.content, translations: Object.fromEntries(keep.map((k) => [k, tr[k]])) } }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "translate", entity: "hotel", entityId: hotel.id, details: { what } });
  });
  return r;
}

type Slot = { key: string; get: () => L | undefined; set: (v: L) => void };

const LOC = new Set<string>(LOCALES);
/** Ein mehrsprachiges Textfeld: Objekt, dessen Schlüssel nur Sprachcodes sind */
function isL10n(v: unknown): v is L {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, x]) => LOC.has(k) && (x === undefined || typeof x === "string"));
}

function walk(node: unknown, path: string, out: Slot[]) {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === "id" || k === "type") continue;
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${path}.${k}${i}`, out));
    else if (isL10n(v) && Object.keys(v).length) out.push({ key: `${path}.${k}`, get: () => o[k] as L, set: (x) => (o[k] = x) });
    else if (v && typeof v === "object") walk(v, `${path}.${k}`, out);
  }
}

/** Alle zweisprachigen Felder einer Seite (Titel, Menü, Google, Bausteine) als Zugriffspunkte */
function pageSlots(page: { title: L; navLabel: L; seo: Partial<Record<Locale, { title?: string; description?: string }>> }, blocks: Block[]): Slot[] {
  const slots: Slot[] = [
    { key: "title", get: () => page.title, set: (v) => (page.title = v) },
    { key: "nav", get: () => page.navLabel, set: (v) => (page.navLabel = v) },
  ];
  for (const f of ["title", "description"] as const) {
    slots.push({
      key: `seo.${f}`,
      get: () => Object.fromEntries(Object.entries(page.seo).map(([l, x]) => [l, x?.[f]])) as L,
      set: (v) => {
        for (const [l, t] of Object.entries(v)) page.seo[l as Locale] = { ...(page.seo[l as Locale] ?? {}), [f]: t };
      },
    });
  }
  // Alle Texte in allen Bausteinen (auch in Listen wie FAQ, Angebote, Tipps), generisch gesucht
  for (const b of blocks) walk(b, b.id, slots);
  return slots;
}

/**
 * Seite übersetzen: alle Felder mit deutschem Text in die angebotenen Sprachen.
 * mode "missing" füllt nur leere Felder (eigene Anpassungen bleiben), "all" überschreibt.
 * Gibt die Anzahl übersetzter Felder zurück; 0 = nichts zu tun (zählt nicht ans Limit).
 */
export async function translatePage(hotel: Hotel, pageId: string, mode: "missing" | "all", actor: string, only?: { blockId?: string; lang?: Locale }): Promise<number> {
  const page = await getPage(hotel.id, pageId);
  if (!page) throw new SiteError("Seite nicht gefunden");
  const targets = hotelLocales(hotel).filter((l) => l !== "de" && (!only?.lang || l === only.lang));
  if (!targets.length) throw new TranslateError("Keine weiteren Sprachen gewählt (Website → Sprachen)");
  const blocks: Block[] = JSON.parse(JSON.stringify(page.blocks));
  const meta = { title: { ...page.title }, navLabel: { ...page.navLabel }, seo: JSON.parse(JSON.stringify(page.seo ?? {})) };
  const slots = pageSlots(meta, blocks).filter((s) => !only?.blockId || s.key.startsWith(`${only.blockId}.`));
  const texts: Record<string, string> = {};
  const need: Record<string, Locale[]> = {};
  for (const s of slots) {
    const v = s.get() ?? {};
    if (!v.de?.trim()) continue;
    const ls = targets.filter((l) => mode === "all" || !v[l]?.trim());
    if (ls.length) {
      texts[s.key] = v.de;
      need[s.key] = ls;
    }
  }
  if (!Object.keys(texts).length) return 0;
  const n = await withQuota(hotel, async () => {
    const res = await translateTexts(texts, targets.filter((l) => Object.values(need).some((x) => x.includes(l))), hotel.name);
    let count = 0;
    for (const s of slots) {
      if (!need[s.key]) continue;
      const v = { ...(s.get() ?? {}) };
      for (const l of need[s.key]) {
        const t = res[l]?.[s.key];
        if (t) { v[l] = t; count++; }
      }
      s.set(v);
    }
    return count;
  }, actor, `page:${pageId}${only?.blockId ? `#${only.blockId}` : ""}`);
  if (!n) return 0;
  const parsed = blocks.map((b) => blockSchema.parse(b));
  await db().update(sitePages).set({ blocks: parsed, title: meta.title, navLabel: meta.navLabel, seo: meta.seo, updatedAt: new Date() }).where(eq(sitePages.id, pageId));
  return n;
}

/** Zimmer- und Tarifnamen sowie Zimmerbeschreibungen in die angebotenen Sprachen (nur leere Felder) */
export async function translateRooms(hotel: Hotel, actor: string): Promise<number> {
  const targets = hotelLocales(hotel).filter((l) => l !== "de");
  if (!targets.length) throw new TranslateError("Keine weiteren Sprachen gewählt (Website → Sprachen)");
  const rts = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
  const rps = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, hotel.id));
  const texts: Record<string, string> = {};
  for (const r of rts) {
    if (targets.some((l) => !r.i18n?.[l as "en"]?.name)) texts[`rt.${r.id}.name`] = r.name;
    if (r.description && targets.some((l) => !r.i18n?.[l as "en"]?.description)) texts[`rt.${r.id}.description`] = r.description;
  }
  for (const p of rps) if (targets.some((l) => !p.i18n?.[l as "en"]?.name)) texts[`rp.${p.id}.name`] = p.name;
  // Zusatzleistungen (Name, Beschreibung)
  const exs = await db().select().from(extras).where(eq(extras.hotelId, hotel.id));
  for (const e of exs) for (const f of ["name", "description"] as const) {
    if (e[f].de && targets.some((l) => !e[f][l])) texts[`ex.${e.id}.${f}`] = e[f].de!;
  }
  if (!Object.keys(texts).length) return 0;
  const n = await withQuota(hotel, async () => {
    const res = await translateTexts(texts, targets, hotel.name);
    let count = 0;
    await db().transaction(async (tx) => {
      for (const r of rts) {
        const i18n = JSON.parse(JSON.stringify(r.i18n ?? {}));
        for (const l of targets) for (const f of ["name", "description"] as const) {
          const t = res[l]?.[`rt.${r.id}.${f}`];
          if (t && !i18n[l]?.[f]) { i18n[l] = { ...(i18n[l] ?? {}), [f]: t }; count++; }
        }
        await tx.update(roomTypes).set({ i18n }).where(eq(roomTypes.id, r.id));
      }
      for (const p of rps) {
        const i18n = JSON.parse(JSON.stringify(p.i18n ?? {}));
        for (const l of targets) {
          const t = res[l]?.[`rp.${p.id}.name`];
          if (t && !i18n[l]?.name) { i18n[l] = { ...(i18n[l] ?? {}), name: t }; count++; }
        }
        await tx.update(ratePlans).set({ i18n }).where(eq(ratePlans.id, p.id));
      }
      for (const e of exs) {
        const next = { name: { ...e.name }, description: { ...e.description } };
        for (const l of targets) for (const f of ["name", "description"] as const) {
          const t = res[l]?.[`ex.${e.id}.${f}`];
          if (t && !next[f][l]) { next[f][l] = t; count++; }
        }
        await tx.update(extras).set(next).where(eq(extras.id, e.id));
      }
    });
    return count;
  }, actor, "rooms");
  return n ?? 0;
}
