import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, roomTypes, setupImports, type Hotel, type SetupImport } from "../db/schema";
import { LIMITS, SYSTEM, htmlToText, isPdf, joinPages, parseDraft, pdfPageEstimate, pickLinks, setupImportGate, type Draft } from "../domain/setup-import";
import { MENU_KEYWORDS, MENU_LIMITS, MENU_SYSTEM, draftToRows, parseMenuDraft, type MenuDraft } from "../domain/menu-import";
import { importItems } from "./pos";
import { env } from "../env";
import { safeFetchText } from "../lib/safe-fetch";
import { audit } from "./audit";
import { createRoomType } from "./rooms";
import { addBlock, ensureHomePage, updateBlock } from "./site";

/**
 * KI-Einrichtung (SPEC 19.36). Kostenbremsen: nur nach Abo (Karte + Bedingungen), je Betrieb und Monat wenige Läufe,
 * Obergrenze aller Läufe je 24 Stunden, begrenzte Textmenge, günstiges Modell, begrenzte Antwort. Es entsteht nur ein Entwurf zur Prüfung.
 */
export class SetupImportError extends Error {}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;
let fetchOverride: FetchLike | null = null;
let pageFetchOverride: ((url: string) => Promise<string>) | null = null;
/** Für Tests: KI-Aufruf und Seitenabruf ersetzen */
export function setSetupImportFetch(ai: FetchLike | null, page: ((url: string) => Promise<string>) | null = null) { fetchOverride = ai; pageFetchOverride = page; }

export const setupImportEnabled = () => !!env().ANTHROPIC_API_KEY && env().SETUP_RUNS_PER_MONTH > 0;

export type Purpose = "hotel" | "menu";

export async function listImports(hotelId: string, purpose: Purpose = "hotel"): Promise<SetupImport[]> {
  return db().select().from(setupImports).where(and(eq(setupImports.hotelId, hotelId), eq(setupImports.purpose, purpose))).orderBy(desc(setupImports.createdAt)).limit(10);
}

export async function importsThisMonth(hotelId: string, now = new Date(), purpose: Purpose = "hotel"): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [r] = await db().select({ n: count() }).from(setupImports).where(and(eq(setupImports.hotelId, hotelId), eq(setupImports.purpose, purpose), gte(setupImports.createdAt, start)));
  return r.n;
}

/** Lauf eröffnen: Sperren prüfen und Zeile anlegen, unter Sperre je Betrieb (kein Doppelklick-Umgehen) */
async function openRun(hotel: Hotel, kind: "url" | "pdf", source: string, actor: string, now: Date, purpose: Purpose = "hotel"): Promise<string> {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  const gate = setupImportGate(h, setupImportEnabled());
  if (!gate.ok) throw new SetupImportError(gate.reason);
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"setup-import:" + hotel.id}))`);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [m] = await tx.select({ n: count() }).from(setupImports).where(and(eq(setupImports.hotelId, hotel.id), eq(setupImports.purpose, purpose), gte(setupImports.createdAt, start)));
    if (m.n >= env().SETUP_RUNS_PER_MONTH) throw new SetupImportError(`Monatslimit erreicht (${env().SETUP_RUNS_PER_MONTH} Läufe). Im nächsten Monat wieder möglich; Zimmer und Texte können Sie jederzeit von Hand eintragen.`);
    const [d] = await tx.select({ n: count() }).from(setupImports).where(gte(setupImports.createdAt, new Date(now.getTime() - 86_400_000)));
    if (d.n >= env().SETUP_RUNS_PER_DAY_TOTAL) throw new SetupImportError("Die KI-Einrichtung ist heute stark ausgelastet. Bitte morgen nochmals versuchen.");
    const [row] = await tx.insert(setupImports).values({ hotelId: hotel.id, kind, purpose, source: source.slice(0, 300), createdBy: actor, createdAt: now }).returning({ id: setupImports.id });
    await audit(tx, { hotelId: hotel.id, actor, action: "setup_import.start", entity: "setup_import", entityId: row.id, details: { kind, purpose } });
    return row.id;
  });
}

async function callAi(content: unknown[], system: string = SYSTEM, maxTokens: number = LIMITS.maxOutputTokens): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new SetupImportError("Die KI-Einrichtung ist nicht eingerichtet.");
  const f: FetchLike = fetchOverride ?? ((u, init) => fetch(u, init));
  let res;
  try {
    res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env().SETUP_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
  } catch (e) { throw new SetupImportError(`KI nicht erreichbar: ${(e as Error).message}`); }
  const body = await res.text();
  if (res.status < 200 || res.status >= 300) throw new SetupImportError(`KI-Dienst: HTTP ${res.status}`);
  try {
    const j = JSON.parse(body) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    return { text: (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
  } catch { throw new SetupImportError("KI-Dienst: unerwartete Antwort"); }
}

async function finish(id: string, hotelId: string, run: () => Promise<{ text: string; inputTokens: number; outputTokens: number }>, parse: (raw: string) => Record<string, unknown> | null = parseDraft as (raw: string) => Record<string, unknown> | null) {
  try {
    const r = await run();
    const draft = parse(r.text);
    if (!draft) {
      await db().update(setupImports).set({ status: "failed", error: "Aus der Quelle liess sich nichts Verlässliches lesen.", inputTokens: r.inputTokens, outputTokens: r.outputTokens }).where(eq(setupImports.id, id));
      throw new SetupImportError("Aus dieser Quelle liess sich nichts Verlässliches lesen. Versuchen Sie eine Seite mit den Zimmern oder ein anderes PDF.");
    }
    await db().update(setupImports).set({ status: "draft", draft, inputTokens: r.inputTokens, outputTokens: r.outputTokens }).where(eq(setupImports.id, id));
    return draft as Draft;
  } catch (e) {
    await db().update(setupImports).set({ status: "failed", error: (e as Error).message.slice(0, 300) }).where(and(eq(setupImports.id, id), eq(setupImports.status, "running")));
    throw e;
  }
}

export async function importFromUrl(hotel: Hotel, rawUrl: string, actor: string, now = new Date()): Promise<string> {
  const url = rawUrl.trim();
  if (!url) throw new SetupImportError("Bitte die Adresse Ihrer Website angeben.");
  const get = pageFetchOverride ?? ((u: string) => safeFetchText(u, { maxBytes: LIMITS.pageBytes, userAgent: "Pontivo-Setup/1.0 (+https://pontivo.ch)", accept: "text/html" }));
  // Seiten holen, bevor ein Lauf zählt: eine nicht erreichbare Adresse verbraucht kein Kontingent
  let first: string;
  try { first = await get(url); } catch (e) { throw new SetupImportError(`Die Website konnte nicht geladen werden: ${(e as Error).message}`); }
  const pages = [{ url, text: htmlToText(first) }];
  for (const link of pickLinks(url, first, LIMITS.maxPages - 1)) {
    try { pages.push({ url: link, text: htmlToText(await get(link)) }); } catch { /* Unterseite nicht lesbar: weglassen */ }
  }
  const text = joinPages(pages.filter((p) => p.text.length > 40));
  if (text.length < 200) throw new SetupImportError("Auf der Website steht zu wenig Text (oft Bilder oder Seiten, die erst im Browser aufgebaut werden). Versuchen Sie ein PDF.");
  const id = await openRun(hotel, "url", url, actor, now);
  await finish(id, hotel.id, () => callAi([{ type: "text", text: `<source>\n${text}\n</source>` }]));
  return id;
}

export async function importFromPdf(hotel: Hotel, bytes: Uint8Array, fileName: string, actor: string, now = new Date()): Promise<string> {
  if (!bytes.length) throw new SetupImportError("Bitte eine PDF-Datei wählen.");
  if (bytes.length > LIMITS.pdfBytes) throw new SetupImportError(`Das PDF ist zu gross (höchstens ${LIMITS.pdfBytes / 1_000_000} MB).`);
  if (!isPdf(bytes)) throw new SetupImportError("Das ist kein PDF.");
  if (pdfPageEstimate(bytes) > LIMITS.pdfPages) throw new SetupImportError(`Das PDF hat zu viele Seiten (höchstens ${LIMITS.pdfPages}). Bitte nur die Seiten mit Zimmern und Infos als PDF speichern.`);
  const id = await openRun(hotel, "pdf", fileName.replace(/[^\w .()-]/g, "").slice(0, 120), actor, now);
  await finish(id, hotel.id, () => callAi([
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
    { type: "text", text: "The hotel brochure is attached as PDF. Extract the draft as instructed." },
  ]));
  return id;
}

export async function getImport(hotelId: string, id: string): Promise<SetupImport | null> {
  const [r] = await db().select().from(setupImports).where(and(eq(setupImports.id, id), eq(setupImports.hotelId, hotelId)));
  return r ?? null;
}

export async function discardImport(hotelId: string, id: string, actor: string) {
  await db().transaction(async (tx) => {
    const r = await tx.update(setupImports).set({ status: "discarded", draft: {} }).where(and(eq(setupImports.id, id), eq(setupImports.hotelId, hotelId), inArray(setupImports.status, ["draft"]))).returning({ id: setupImports.id });
    if (r.length) await audit(tx, { hotelId, actor, action: "setup_import.discard", entity: "setup_import", entityId: id });
  });
}

export type Picks = { intro: boolean; rooms: number[]; faq: number[] };

/** Gewählte Teile des Entwurfs übernehmen. Zimmer ohne Preise (die trägt der Betrieb selbst ein), Einleitung nur wenn noch leer. */
export async function adoptImport(hotel: Hotel, id: string, picks: Picks, actor: string): Promise<{ rooms: number; skippedRooms: number; faq: number; intro: boolean }> {
  const imp = await getImport(hotel.id, id);
  if (!imp || imp.status !== "draft") throw new SetupImportError("Dieser Entwurf ist nicht mehr offen.");
  const d = imp.draft as unknown as Draft;
  // Status zuerst atomar umstellen: kein doppeltes Übernehmen
  const claimed = await db().update(setupImports).set({ status: "adopted", adoptedAt: new Date() }).where(and(eq(setupImports.id, id), eq(setupImports.status, "draft"))).returning({ id: setupImports.id });
  if (!claimed.length) throw new SetupImportError("Dieser Entwurf ist nicht mehr offen.");
  let rooms = 0, skippedRooms = 0, faq = 0, intro = false;
  const have = await db().select({ name: roomTypes.name }).from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
  const names = new Set(have.map((r) => r.name.trim().toLowerCase()));
  let order = have.length;
  for (const i of new Set(picks.rooms)) {
    const r = d.rooms?.[i];
    if (!r) continue;
    if (names.has(r.name.trim().toLowerCase())) { skippedRooms++; continue; }
    await createRoomType(hotel.id, { name: r.name, description: r.description || null, roomCount: r.roomCount, maxAdults: r.maxAdults, maxChildren: r.maxChildren, maxOccupancy: r.maxAdults + r.maxChildren, sortOrder: order++, active: true, i18n: {} }, actor);
    names.add(r.name.trim().toLowerCase());
    rooms++;
  }
  const items = [...new Set(picks.faq)].map((i) => d.faq?.[i]).filter((x): x is NonNullable<typeof x> => !!x);
  if (items.length) {
    const home = await ensureHomePage(hotel, actor);
    const blockId = await addBlock(hotel.id, home.id, "faq", actor);
    await updateBlock(hotel.id, home.id, blockId, { id: blockId, type: "faq", heading: { de: "Häufige Fragen" }, items: items.map((x) => ({ q: { de: x.q }, a: { de: x.a } })) }, actor);
    faq = items.length;
  }
  if (picks.intro && d.intro) {
    await db().transaction(async (tx) => {
      const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
      if (h.content.de?.intro?.trim()) return; // vorhandene Einleitung nie überschreiben
      await tx.update(hotels).set({ content: { ...h.content, de: { ...(h.content.de ?? {}), intro: d.intro } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
      intro = true;
    });
  }
  await db().transaction(async (tx) => {
    await audit(tx, { hotelId: hotel.id, actor, action: "setup_import.adopt", entity: "setup_import", entityId: id, details: { rooms, skippedRooms, faq, intro } });
    await tx.update(setupImports).set({ draft: {} }).where(eq(setupImports.id, id)); // Entwurfsdaten nach der Übernahme nicht aufbewahren
  });
  return { rooms, skippedRooms, faq, intro };
}


// ---------------------------------------------------------------- Speisekarte (SPEC 19.49 Etappe D)

const menuText = (t: string) => `<source>\n${t}\n</source>`;

export async function importMenuFromUrl(hotel: Hotel, rawUrl: string, actor: string, now = new Date()): Promise<string> {
  const url = rawUrl.trim();
  if (!url) throw new SetupImportError("Bitte die Adresse der Speisekarte angeben.");
  const get = pageFetchOverride ?? ((u: string) => safeFetchText(u, { maxBytes: LIMITS.pageBytes, userAgent: "Pontivo-Setup/1.0 (+https://pontivo.ch)", accept: "text/html" }));
  let first: string;
  try { first = await get(url); } catch (e) { throw new SetupImportError(`Die Website konnte nicht geladen werden: ${(e as Error).message}`); }
  const pages = [{ url, text: htmlToText(first) }];
  for (const link of pickLinks(url, first, LIMITS.maxPages - 1, MENU_KEYWORDS)) {
    try { pages.push({ url: link, text: htmlToText(await get(link)) }); } catch { /* Unterseite nicht lesbar */ }
  }
  const text = joinPages(pages.filter((p) => p.text.length > 40));
  if (text.length < 100) throw new SetupImportError("Auf der Seite steht zu wenig Text (oft ein Bild oder ein PDF zum Herunterladen). Versuchen Sie, das PDF der Speisekarte hochzuladen.");
  const id = await openRun(hotel, "url", url, actor, now, "menu");
  await finish(id, hotel.id, () => callAi([{ type: "text", text: menuText(text) }], MENU_SYSTEM, MENU_LIMITS.maxOutputTokens), parseMenuDraft);
  return id;
}

export async function importMenuFromPdf(hotel: Hotel, bytes: Uint8Array, fileName: string, actor: string, now = new Date()): Promise<string> {
  if (!bytes.length) throw new SetupImportError("Bitte eine PDF-Datei wählen.");
  if (bytes.length > LIMITS.pdfBytes) throw new SetupImportError(`Das PDF ist zu gross (höchstens ${LIMITS.pdfBytes / 1_000_000} MB).`);
  if (!isPdf(bytes)) throw new SetupImportError("Das ist kein PDF.");
  if (pdfPageEstimate(bytes) > LIMITS.pdfPages) throw new SetupImportError(`Das PDF hat zu viele Seiten (höchstens ${LIMITS.pdfPages}).`);
  const id = await openRun(hotel, "pdf", fileName.replace(/[^\w .()-]/g, "").slice(0, 120), actor, now, "menu");
  await finish(id, hotel.id, () => callAi([
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
    { type: "text", text: "The menu is attached as PDF. Extract the items as instructed." },
  ], MENU_SYSTEM, MENU_LIMITS.maxOutputTokens), parseMenuDraft);
  return id;
}

export type MenuPick = { index: number; category: string; name: string; priceRappen: number };

/**
 * Geprüfte Artikel übernehmen (Name, Kategorie und Preis darf der Betrieb im Entwurf noch ändern). Gleichnamige Artikel gibt es schon: übersprungen.
 * Status zuerst atomar umstellen: kein doppeltes Übernehmen.
 */
export async function adoptMenu(hotel: Hotel, id: string, picks: MenuPick[], actor: string): Promise<{ created: number; skipped: number }> {
  const imp = await getImport(hotel.id, id);
  if (!imp || imp.purpose !== "menu" || imp.status !== "draft") throw new SetupImportError("Dieser Entwurf ist nicht mehr offen.");
  const d = imp.draft as unknown as MenuDraft;
  const rows = draftToRows(
    picks.filter((p, i, a) => d.items?.[p.index] && a.findIndex((x) => x.index === p.index) === i)
      .map((p) => ({ category: p.category.trim().slice(0, 60), name: p.name.trim(), description: "", priceRappen: p.priceRappen })),
  ).filter((r) => r.name && r.name.length <= 120 && Number.isInteger(r.priceRappen) && r.priceRappen >= 0 && r.priceRappen <= 10_000_000);
  if (!rows.length) throw new SetupImportError("Bitte mindestens einen Artikel wählen.");
  const claimed = await db().update(setupImports).set({ status: "adopted", adoptedAt: new Date() }).where(and(eq(setupImports.id, id), eq(setupImports.status, "draft"))).returning({ id: setupImports.id });
  if (!claimed.length) throw new SetupImportError("Dieser Entwurf ist nicht mehr offen.");
  const res = await importItems(hotel.id, rows, actor);
  await db().transaction(async (tx) => {
    await audit(tx, { hotelId: hotel.id, actor, action: "setup_import.adopt_menu", entity: "setup_import", entityId: id, details: res });
    await tx.update(setupImports).set({ draft: {} }).where(eq(setupImports.id, id));
  });
  return res;
}
