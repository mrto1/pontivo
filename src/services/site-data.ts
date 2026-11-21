import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { posItems, type Hotel } from "../db/schema";
import type { Block } from "../domain/blocks";
import { getSettings } from "./reservations";

type Menu = Extract<Block, { type: "menu" }>;
type Hours = Extract<Block, { type: "hours" }>;

/** Öffnungszeiten der Grunddaten (Schlüssel 0 = Sonntag) → Tage des Bausteins (Index 0 = Montag) */
export function daysFromOpening(h: Record<string, { from: string; to: string }[]> | null | undefined): Hours["days"] {
  return Array.from({ length: 7 }, (_, i) => (h?.[String((i + 1) % 7)] ?? []).slice(0, 3).map((w) => ({ from: w.from, to: w.to })));
}

/**
 * Bausteine mit Daten aus dem Betrieb füllen (SPEC 20.7): Speisekarte aus den Artikeln, Öffnungszeiten aus den Grunddaten.
 * Website, Online-Bestellung und Kasse zeigen so dieselbe Karte. Für Darstellung, strukturierte Daten und KI-Wissen.
 */
export async function resolveBlocks(hotel: Pick<Hotel, "id">, blocks: Block[]): Promise<Block[]> {
  const needItems = blocks.some((b) => b.type === "menu" && b.source === "items");
  const needHours = blocks.some((b) => b.type === "hours" && b.source === "opening");
  if (!needItems && !needHours) return blocks;
  const items = needItems
    ? await db().select().from(posItems).where(and(eq(posItems.hotelId, hotel.id), eq(posItems.active, true))).orderBy(asc(posItems.sortOrder), asc(posItems.category), asc(posItems.name))
    : [];
  const opening = needHours ? (await getSettings(hotel.id)).openingHours : null;
  // Rubriken zusammenhalten (Reihenfolge der ersten Nennung), damit gleiche Rubriken einen Abschnitt bilden
  const order = [...new Set(items.map((i) => i.category ?? ""))];
  const sorted = [...items].sort((a, b) => order.indexOf(a.category ?? "") - order.indexOf(b.category ?? ""));
  const menuItems: Menu["items"] = sorted.slice(0, 300).map((i) => ({
    section: i.category ? { de: i.category } : {}, name: { de: i.name }, text: i.description ? { de: i.description } : {},
    priceRappen: i.priceRappen, diet: "", glutenFree: false, allergens: i.allergens,
  }));
  return blocks.map((b) => {
    if (b.type === "menu" && b.source === "items") return { ...b, items: menuItems };
    if (b.type === "hours" && b.source === "opening") return { ...b, days: daysFromOpening(opening) };
    return b;
  });
}
