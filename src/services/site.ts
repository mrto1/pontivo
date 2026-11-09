import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotels, sitePages, type Hotel, type HotelDocument, type SitePage } from "../db/schema";
import { blockSchema, newBlock, RESERVED_SLUGS, slugify, type Block, type BlockType } from "../domain/blocks";
import { audit } from "./audit";

export class SiteError extends Error {}

export async function listPages(hotelId: string) {
  return db().select().from(sitePages).where(eq(sitePages.hotelId, hotelId)).orderBy(asc(sitePages.sortOrder), asc(sitePages.createdAt));
}

export async function getPage(hotelId: string, pageId: string) {
  const [p] = await db().select().from(sitePages).where(and(eq(sitePages.hotelId, hotelId), eq(sitePages.id, pageId)));
  return p ?? null;
}

/** Öffentliche Seite (nur veröffentlicht) */
export async function getPublicPage(hotelId: string, slug: string) {
  const [p] = await db().select().from(sitePages).where(and(eq(sitePages.hotelId, hotelId), eq(sitePages.slug, slug), eq(sitePages.published, true)));
  return p ?? null;
}

/** Menüeinträge: veröffentlichte Seiten mit show_in_nav, ohne Startseite */
export async function navPages(hotelId: string) {
  return (await listPages(hotelId)).filter((p) => p.published && p.showInNav && p.slug !== "");
}

const newId = () => crypto.randomBytes(6).toString("base64url");

/** Startseite anlegen, falls es sie noch nicht gibt – vorbefüllt mit den bisherigen Texten und dem ersten Hotelfoto */
export async function ensureHomePage(hotel: Hotel, actor: string): Promise<SitePage> {
  const [existing] = await db().select().from(sitePages).where(and(eq(sitePages.hotelId, hotel.id), eq(sitePages.slug, "")));
  if (existing) return existing;
  const photo = hotel.content.photos?.[0];
  const blocks: Block[] = [
    blockSchema.parse({
      id: newId(),
      type: "hero",
      headline: { de: hotel.content.de?.headline ?? hotel.name, en: hotel.content.en?.headline ?? hotel.name },
      intro: { de: hotel.content.de?.intro ?? "", en: hotel.content.en?.intro ?? "" },
      image: photo && /^\/media\//.test(photo.url) ? { url: photo.url, alt: photo.alt } : null,
    }),
    newBlock("rooms", newId()),
  ];
  const [p] = await db()
    .insert(sitePages)
    .values({ hotelId: hotel.id, slug: "", title: { de: "Startseite", en: "Home" }, navLabel: {}, showInNav: false, sortOrder: 0, blocks })
    .onConflictDoNothing()
    .returning();
  if (!p) return (await db().select().from(sitePages).where(and(eq(sitePages.hotelId, hotel.id), eq(sitePages.slug, ""))))[0];
  await audit(db(), { hotelId: hotel.id, actor, action: "site.page_create", entity: "site_page", entityId: p.id, details: { slug: "" } });
  return p;
}

async function uniqueSlug(hotelId: string, base: string, exceptId?: string): Promise<string> {
  let slug = slugify(base) || "seite";
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-seite`;
  const taken = new Set((await listPages(hotelId)).filter((p) => p.id !== exceptId).map((p) => p.slug));
  let s = slug;
  for (let i = 2; taken.has(s); i++) s = `${slug}-${i}`;
  return s;
}

export async function createPage(hotelId: string, titleDe: string, actor: string, blocks?: Block[]) {
  const title = titleDe.trim().slice(0, 120);
  if (!title) throw new SiteError("Titel fehlt");
  const slug = await uniqueSlug(hotelId, title);
  const [{ max }] = rows<{ max: number }>(await db().execute(sql`SELECT coalesce(max(sort_order), 0)::int AS max FROM site_pages WHERE hotel_id = ${hotelId}`));
  const [p] = await db()
    .insert(sitePages)
    .values({ hotelId, slug, title: { de: title }, navLabel: { de: title }, sortOrder: max + 1, blocks: blocks ?? [newBlock("text", newId())] })
    .returning();
  await audit(db(), { hotelId, actor, action: "site.page_create", entity: "site_page", entityId: p.id, details: { slug } });
  return p;
}

const opt = (max: number) => z.string().trim().max(max).optional();
export const pageMetaSchema = z.object({
  title: z.object({ de: opt(120), en: opt(120), fr: opt(120), it: opt(120), nl: opt(120) }),
  navLabel: z.object({ de: opt(40), en: opt(40), fr: opt(40), it: opt(40), nl: opt(40) }),
  slug: z.string().trim().max(60),
  showInNav: z.boolean(),
  published: z.boolean(),
  seo: z.object({
    de: z.object({ title: opt(70), description: opt(170) }),
    en: z.object({ title: opt(70), description: opt(170) }),
    fr: z.object({ title: opt(70), description: opt(170) }).default({}),
    it: z.object({ title: opt(70), description: opt(170) }).default({}),
    nl: z.object({ title: opt(70), description: opt(170) }).default({}),
  }),
});

export async function updatePageMeta(hotelId: string, pageId: string, input: z.input<typeof pageMetaSchema>, actor: string) {
  const v = pageMetaSchema.parse(input);
  const page = await getPage(hotelId, pageId);
  if (!page) throw new SiteError("Seite nicht gefunden");
  if (!v.title.de && !v.title.en) throw new SiteError("Titel fehlt");
  let slug = page.slug;
  if (page.slug !== "") {
    const wanted = slugify(v.slug || v.title.de || v.title.en || "");
    if (!wanted) throw new SiteError("Adresse fehlt");
    if (RESERVED_SLUGS.has(wanted)) throw new SiteError(`Die Adresse «${wanted}» ist reserviert`);
    if (wanted !== page.slug) {
      const clash = (await listPages(hotelId)).some((p) => p.slug === wanted && p.id !== pageId);
      if (clash) throw new SiteError(`Die Adresse «${wanted}» gibt es schon`);
      slug = wanted;
    }
  }
  await db()
    .update(sitePages)
    .set({
      title: v.title, navLabel: v.navLabel, slug,
      showInNav: page.slug === "" ? false : v.showInNav,
      published: page.slug === "" ? true : v.published,
      seo: v.seo, updatedAt: new Date(),
    })
    .where(and(eq(sitePages.id, pageId), eq(sitePages.hotelId, hotelId)));
  await audit(db(), { hotelId, actor, action: "site.page_update", entity: "site_page", entityId: pageId, details: { slug } });
}

export async function deletePage(hotelId: string, pageId: string, actor: string) {
  const page = await getPage(hotelId, pageId);
  if (!page) throw new SiteError("Seite nicht gefunden");
  if (page.slug === "") throw new SiteError("Die Startseite kann nicht gelöscht werden");
  await db().delete(sitePages).where(and(eq(sitePages.id, pageId), eq(sitePages.hotelId, hotelId)));
  await audit(db(), { hotelId, actor, action: "site.page_delete", entity: "site_page", entityId: pageId, details: { slug: page.slug } });
}

/** Seite im Menü nach oben/unten verschieben (Startseite bleibt immer zuerst) */
export async function movePage(hotelId: string, pageId: string, dir: -1 | 1, actor: string) {
  const pages = (await listPages(hotelId)).filter((p) => p.slug !== "");
  const i = pages.findIndex((p) => p.id === pageId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= pages.length) return;
  [pages[i], pages[j]] = [pages[j], pages[i]];
  await db().transaction(async (tx) => {
    for (const [k, p] of pages.entries()) await tx.update(sitePages).set({ sortOrder: k + 1 }).where(eq(sitePages.id, p.id));
  });
  await audit(db(), { hotelId, actor, action: "site.page_move", entity: "site_page", entityId: pageId });
}

// ---------------------------------------------------------------- Bausteine

async function mutateBlocks(hotelId: string, pageId: string, actor: string, action: string, fn: (blocks: Block[]) => Block[]) {
  await db().transaction(async (tx) => {
    const [p] = rows<{ blocks: Block[] }>(await tx.execute(sql`SELECT blocks FROM site_pages WHERE id = ${pageId} AND hotel_id = ${hotelId} FOR UPDATE`));
    if (!p) throw new SiteError("Seite nicht gefunden");
    const next = fn(p.blocks);
    if (next.length > 40) throw new SiteError("Höchstens 40 Bausteine pro Seite");
    await tx.update(sitePages).set({ blocks: next, updatedAt: new Date() }).where(eq(sitePages.id, pageId));
    await audit(tx, { hotelId, actor, action, entity: "site_page", entityId: pageId });
  });
}

export async function addBlock(hotelId: string, pageId: string, type: BlockType, actor: string): Promise<string> {
  const id = newId();
  await mutateBlocks(hotelId, pageId, actor, "site.block_add", (b) => [...b, newBlock(type, id)]);
  return id;
}

/** Baustein ersetzen; Typ und ID bleiben. Bilder müssen zur Bibliothek dieses Hotels gehören. */
export async function updateBlock(hotelId: string, pageId: string, blockId: string, data: unknown, actor: string) {
  const parsed = blockSchema.parse(data);
  const urls = JSON.stringify(parsed).match(/\/media\/[0-9a-f-]{36}\//g) ?? [];
  if (urls.some((u) => u !== `/media/${hotelId}/`)) throw new SiteError("Bild gehört nicht zu diesem Hotel");
  await mutateBlocks(hotelId, pageId, actor, "site.block_update", (blocks) => {
    const i = blocks.findIndex((b) => b.id === blockId);
    if (i < 0) throw new SiteError("Baustein nicht gefunden");
    if (blocks[i].type !== parsed.type) throw new SiteError("Bausteintyp kann nicht geändert werden");
    const next = [...blocks];
    next[i] = { ...parsed, id: blockId } as Block;
    return next;
  });
}

export async function moveBlock(hotelId: string, pageId: string, blockId: string, dir: -1 | 1, actor: string) {
  await mutateBlocks(hotelId, pageId, actor, "site.block_move", (blocks) => {
    const i = blocks.findIndex((b) => b.id === blockId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return blocks;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

export async function deleteBlock(hotelId: string, pageId: string, blockId: string, actor: string) {
  await mutateBlocks(hotelId, pageId, actor, "site.block_delete", (blocks) => blocks.filter((b) => b.id !== blockId));
}

/** Foto-Bibliothek: Hotelfotos + Zimmerfotos */
export async function photoLibrary(hotel: Hotel) {
  const { roomTypes } = await import("../db/schema");
  const rts = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
  const all = [...(hotel.content.photos ?? []), ...rts.flatMap((r) => r.photos.map((p) => ({ ...p, alt: p.alt ?? r.name })))];
  const seen = new Set<string>();
  return all.filter((p) => /^\/media\//.test(p.url) && !seen.has(p.url) && seen.add(p.url));
}

/** Impressum als Seite anlegen, vorbefüllt mit den Hoteldaten (bitte ergänzen: Rechtsform, UID, verantwortliche Person) */
export async function createImprintPage(hotel: Hotel, actor: string) {
  const existing = (await listPages(hotel.id)).find((p) => p.slug === "impressum");
  if (existing) return existing;
  const lines = [hotel.legalName ?? hotel.name, hotel.addressLine, [hotel.postalCode, hotel.city].filter(Boolean).join(" ")].filter(Boolean).join("\n");
  const de = `${lines}\n\nE-Mail: ${hotel.contactEmail}${hotel.contactPhone ? `\nTelefon: ${hotel.contactPhone}` : ""}\n\nVertretungsberechtigte Person: [Name]\nUnternehmens-Identifikationsnummer (UID): [CHE-…]\nHandelsregister: [Kanton, falls eingetragen]`;
  const en = `${lines}\n\nEmail: ${hotel.contactEmail}${hotel.contactPhone ? `\nPhone: ${hotel.contactPhone}` : ""}\n\nAuthorised representative: [Name]\nCompany ID (UID): [CHE-…]\nCommercial register: [canton, if registered]`;
  const p = await createPage(hotel.id, "Impressum", actor, [
    blockSchema.parse({ id: newId(), type: "text", heading: { de: "Impressum", en: "Legal notice" }, body: { de, en } }),
  ]);
  await db().update(sitePages).set({ showInNav: false, title: { de: "Impressum", en: "Legal notice" } }).where(eq(sitePages.id, p.id));
  return p;
}

export async function hotelById(id: string) {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, id));
  return h ?? null;
}

// ---------------------------------------------------------------- Dokumente (PDF)

export const MAX_DOCUMENTS = 30;

/** Dokument in die Bibliothek aufnehmen (Datei ist bereits gespeichert) */
export async function addDocument(hotelId: string, doc: HotelDocument, actor: string) {
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotelId)).for("update");
    if (!h) throw new SiteError("Hotel nicht gefunden");
    const docs = h.content.documents ?? [];
    if (docs.length >= MAX_DOCUMENTS) throw new SiteError(`Höchstens ${MAX_DOCUMENTS} Dokumente`);
    const title = Object.fromEntries(Object.entries(doc.title).map(([k, v]) => [k, v?.trim().slice(0, 120) || undefined]).filter(([, v]) => v)) as HotelDocument["title"];
    if (!Object.keys(title).length) throw new SiteError("Titel fehlt");
    await tx.update(hotels).set({ content: { ...h.content, documents: [...docs, { ...doc, title }] } }).where(eq(hotels.id, hotelId));
    await audit(tx, { hotelId, actor, action: "document.add", entity: "hotel", entityId: hotelId, details: { url: doc.url } });
  });
}

/** Dokument entfernen; gibt die URL zurück, damit die Datei gelöscht werden kann. Verweise in Bausteinen werden beim Anzeigen übersprungen. */
export async function removeDocument(hotelId: string, url: string, actor: string): Promise<string> {
  return db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotelId)).for("update");
    const docs = h?.content.documents ?? [];
    if (!docs.some((d) => d.url === url)) throw new SiteError("Dokument nicht gefunden");
    await tx.update(hotels).set({ content: { ...h.content, documents: docs.filter((d) => d.url !== url) } }).where(eq(hotels.id, hotelId));
    await audit(tx, { hotelId, actor, action: "document.remove", entity: "hotel", entityId: hotelId, details: { url } });
    return url;
  });
}

export function documentLibrary(hotel: Hotel): HotelDocument[] {
  return (hotel.content.documents ?? []).filter((d) => /^\/media\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{16,64}\.pdf$/.test(d.url));
}
