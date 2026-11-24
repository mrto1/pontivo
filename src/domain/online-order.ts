import type { Locale } from "../i18n/dict";
import { fromMin, openAt, toMin, type OpeningHours } from "./reservations";

/**
 * Online-Bestellung (SPEC 20.4/20.5): reine Logik ohne I/O. Zeiten lokal 'HH:MM', Tage 'YYYY-MM-DD', Beträge in Rappen.
 */

/** Die 14 deklarationspflichtigen Allergene (LIV Anhang 6), Codes fest, Anzeige je Sprache */
export const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"] as const;
export type Allergen = (typeof ALLERGENS)[number];
export const ALLERGEN_LABEL: Record<Allergen, Record<Locale, string>> = {
  gluten: { de: "Gluten", en: "Gluten", fr: "Gluten", it: "Glutine", nl: "Gluten" },
  crustaceans: { de: "Krebstiere", en: "Crustaceans", fr: "Crustacés", it: "Crostacei", nl: "Schaaldieren" },
  eggs: { de: "Eier", en: "Eggs", fr: "Œufs", it: "Uova", nl: "Eieren" },
  fish: { de: "Fisch", en: "Fish", fr: "Poisson", it: "Pesce", nl: "Vis" },
  peanuts: { de: "Erdnüsse", en: "Peanuts", fr: "Arachides", it: "Arachidi", nl: "Pinda's" },
  soy: { de: "Soja", en: "Soy", fr: "Soja", it: "Soia", nl: "Soja" },
  milk: { de: "Milch (Laktose)", en: "Milk (lactose)", fr: "Lait (lactose)", it: "Latte (lattosio)", nl: "Melk (lactose)" },
  nuts: { de: "Schalenfrüchte (Nüsse)", en: "Tree nuts", fr: "Fruits à coque", it: "Frutta a guscio", nl: "Noten" },
  celery: { de: "Sellerie", en: "Celery", fr: "Céleri", it: "Sedano", nl: "Selderij" },
  mustard: { de: "Senf", en: "Mustard", fr: "Moutarde", it: "Senape", nl: "Mosterd" },
  sesame: { de: "Sesam", en: "Sesame", fr: "Sésame", it: "Sesamo", nl: "Sesam" },
  sulphites: { de: "Sulfite", en: "Sulphites", fr: "Sulfites", it: "Solfiti", nl: "Sulfieten" },
  lupin: { de: "Lupinen", en: "Lupin", fr: "Lupin", it: "Lupini", nl: "Lupine" },
  molluscs: { de: "Weichtiere", en: "Molluscs", fr: "Mollusques", it: "Molluschi", nl: "Weekdieren" },
};
export const cleanAllergens = (list: string[]): Allergen[] => ALLERGENS.filter((a) => list.includes(a));

export type SlotInput = {
  openingHours: OpeningHours | null | undefined;
  day: string;
  now: { day: string; minutes: number };
  slotMinutes: number;
  leadMin: number;
  cutoffMin: number;
  /** Lieferung: zusätzliche Minuten des Gebiets */
  extraMin?: number;
  capacity: number;
  /** schon belegte Bestellungen je Zeit 'HH:MM' */
  taken: Map<string, number>;
};
export type OrderSlot = { time: string; ok: boolean };

/**
 * Abhol- bzw. Lieferzeiten eines Tages: innerhalb der Öffnungszeiten im Raster, frühestens jetzt + Vorlauf (+ Lieferzeit),
 * spätestens Schliessung − Bestellschluss. Ohne Öffnungszeiten gibt es keine Zeiten (Online-Bestellung braucht sie).
 */
export function orderSlots(i: SlotInput): OrderSlot[] {
  if (!i.openingHours) return [];
  if (i.day < i.now.day) return [];
  const windows = i.openingHours[String(new Date(`${i.day}T00:00:00Z`).getUTCDay())] ?? [];
  const earliest = i.day === i.now.day ? i.now.minutes + i.leadMin + (i.extraMin ?? 0) : -1;
  const out: OrderSlot[] = [];
  for (const w of windows) {
    const last = toMin(w.to) - i.cutoffMin + (i.extraMin ?? 0);
    for (let m = toMin(w.from) + (i.extraMin ?? 0); m <= last; m += i.slotMinutes) {
      if (m < earliest || m >= 24 * 60) continue;
      const t = fromMin(m);
      out.push({ time: t, ok: (i.taken.get(t) ?? 0) < i.capacity });
    }
  }
  return out;
}

/** Ist der Betrieb jetzt offen? (für Herzschlag und «Zurzeit keine Online-Bestellungen») */
export const openNow = (h: OpeningHours | null | undefined, now: { day: string; minutes: number }) => !!h && openAt(h, now.day, fromMin(now.minutes));

export type ZoneLite = { id: string; name: string; postalCodes: string[]; minOrderRappen: number; feeRappen: number; freeFromRappen: number | null; extraMinutes: number; active: boolean };

/** Liefergebiet zur PLZ (erstes aktives Gebiet, das sie enthält) */
export const zoneFor = <Z extends ZoneLite>(zones: Z[], postalCode: string): Z | null =>
  zones.find((z) => z.active && z.postalCodes.includes(postalCode.trim())) ?? null;

/** Liefergebühr: gratis ab Betrag, sonst Gebühr des Gebiets */
export const deliveryFee = (z: ZoneLite, subtotalRappen: number) => (z.freeFromRappen !== null && subtotalRappen >= z.freeFromRappen ? 0 : z.feeRappen);

/** Postleitzahlen aus Text («8000, 8001 8002») → Liste von 4-stelligen PLZ (CH) */
export function parsePostalCodes(t: string): string[] | null {
  const parts = t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^\d{4}$/.test(p))) return null;
  return [...new Set(parts)];
}

/** Normierte Adresse (für die Markierung «früher nicht angenommen») */
export const addressKey = (street: string, houseNo: string, postalCode: string) =>
  `${street}|${houseNo}|${postalCode}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/str(asse|\.)?\b/g, "str").replace(/[^a-z0-9|]/g, "");

export const orderNumber = (n: number) => `A-${String(n).padStart(3, "0")}`;

export type GoLiveInput = { hasOpeningHours: boolean; onlineItems: number; stripeReady: boolean; testPassed: boolean; pickup: boolean; delivery: boolean; activeZones: number };
/** Was fehlt noch, bevor die Online-Bestellung live gehen darf? (leer = bereit) */
export function goLiveProblems(i: GoLiveInput): { key: string; text: string }[] {
  const p: { key: string; text: string }[] = [];
  if (!i.hasOpeningHours) p.push({ key: "hours", text: "Öffnungszeiten fehlen (Betriebsdaten)." });
  if (!i.onlineItems) p.push({ key: "items", text: "Kein Artikel ist online bestellbar (Speisekarte)." });
  if (!i.pickup && !i.delivery) p.push({ key: "kind", text: "Weder Abholung noch Lieferung ist eingeschaltet." });
  if (i.delivery && !i.activeZones) p.push({ key: "zones", text: "Für die Lieferung fehlt ein Liefergebiet." });
  if (!i.stripeReady) p.push({ key: "stripe", text: "Stripe hat Zahlungen noch nicht freigegeben (Prüfung meist 1–2 Werktage)." });
  if (!i.testPassed) p.push({ key: "test", text: "Probebestellung noch nicht bestanden (empfangen, annehmen, «bereit» melden)." });
  return p;
}

/** Nimmt der Betrieb gerade Bestellungen an? */
export const acceptsOrders = (s: { enabled: boolean; pausedUntil: Date | null; autoPaused: boolean }, now: Date) =>
  s.enabled && !s.autoPaused && !(s.pausedUntil && s.pausedUntil.getTime() > now.getTime());
