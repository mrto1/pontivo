import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, type Hotel, type PortalI18n, type PortalSettings } from "../db/schema";
import { MAX_TIPS, MAX_WISHES, STANDARD_WISHES, type WishOption } from "../domain/portal";
import { audit } from "./audit";

/** Einstellungen des Gästeportals (SPEC 19.41), liegen in hotels.content.portal; keine Migration nötig */
const clean = (v: PortalI18n | undefined): PortalI18n => Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, String(x ?? "").trim()]).filter(([, x]) => x)) as PortalI18n;

async function mutate(hotel: Hotel, actor: string, action: string, fn: (p: PortalSettings) => PortalSettings) {
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
    const portal = fn({ ...(h.content.portal ?? {}) });
    await tx.update(hotels).set({ content: { ...h.content, portal }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action, entity: "hotel", entityId: hotel.id });
  });
}

/** Schalter und Wunschliste: angehakte Standardwünsche (mit allen Sprachen) plus eigene Wünsche (eine Zeile je Wunsch, Deutsch, optional « | Englisch») */
export async function savePortalSettings(hotel: Hotel, actor: string, input: { requests: boolean; doorCode: boolean; folio: boolean; selfCheckout: boolean; standardIds: string[]; custom: string }) {
  const standard: WishOption[] = STANDARD_WISHES.filter((w) => input.standardIds.includes(w.id)).map((w) => ({ id: w.id, label: w.label }));
  const custom: WishOption[] = input.custom.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const [de, en] = line.split("|").map((x) => x.trim());
    return { id: `c${i + 1}`, label: clean({ de: de.slice(0, 80), en: (en ?? "").slice(0, 80) }) };
  }).filter((w) => w.label.de);
  const wishes = [...standard, ...custom].slice(0, MAX_WISHES);
  await mutate(hotel, actor, "hotel.portal_settings", (p) => ({ ...p, requests: input.requests, doorCode: input.doorCode, folio: input.folio, selfCheckout: input.selfCheckout, wishes }));
}

export async function addPortalTip(hotel: Hotel, actor: string, input: { title: PortalI18n; text: PortalI18n }) {
  const title = clean(input.title), text = clean(input.text);
  if (!title.de && !title.en) throw new Error("Titel fehlt.");
  await mutate(hotel, actor, "hotel.portal_tip_add", (p) => {
    const tips = [...(p.tips ?? []), { id: randomUUID().slice(0, 8), title, text }];
    if (tips.length > MAX_TIPS) throw new Error(`Höchstens ${MAX_TIPS} Tipps.`);
    return { ...p, tips };
  });
}

export async function deletePortalTip(hotel: Hotel, actor: string, id: string) {
  await mutate(hotel, actor, "hotel.portal_tip_delete", (p) => ({ ...p, tips: (p.tips ?? []).filter((t) => t.id !== id) }));
}
