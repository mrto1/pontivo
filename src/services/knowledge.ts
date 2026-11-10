import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { extras, ratePlans, roomTypes, type Hotel } from "../db/schema";
import { plainText } from "../domain/richtext";
import { tr, type Block } from "../domain/blocks";
import { planName, roomDescription, roomName } from "../domain/i18n-names";
import { cancellationPolicyText } from "../domain/cancellation";
import type { Locale } from "../i18n/dict";
import { listPages } from "./site";

/**
 * Wissen über ein Hotel, aus den Daten der Website zusammengestellt (eine Quelle für Website und KI-Chat):
 * Stammdaten, Zimmer und Tarife, häufige Fragen, Ausflugstipps, Angaben (Öffnungszeiten usw.), Anreise, Angebote.
 * Für den späteren KI-Chat (vor der Buchung und während des Aufenthalts) – er darf nur hieraus antworten.
 */
export type HotelKnowledge = {
  hotel: { name: string; address: string; email: string; phone: string | null; checkin: string; checkout: string };
  rooms: { name: string; description: string | null; maxGuests: number; plans: { name: string; breakfast: boolean; minNights: number; cancellation: string }[] }[];
  faq: { q: string; a: string }[];
  tips: { title: string; text: string; category: string; season: string; distance: string; url: string | null }[];
  facts: { label: string; value: string }[];
  arrival: string[];
  offers: { title: string; text: string; price: string; minNights: number }[];
  /** Zusatzleistungen (Preis in CHF, Einheit z. B. per_night) */
  extras: { name: string; description: string; priceChf: string; unit: string; mandatory: boolean }[];
  /** Speisekarte (Preise in CHF) */
  menu: { section: string; name: string; text: string; priceChf: string | null; diet: string; glutenFree: boolean }[];
  /** Öffnungszeiten (Restaurant, Rezeption …): Tag 0 = Montag, leere Liste = geschlossen */
  hours: { place: string; title: string; days: { from: string; to: string }[][]; closures: { from: string; to: string; label: string }[] }[];
};

export async function hotelKnowledge(hotel: Hotel, lang: Locale): Promise<HotelKnowledge> {
  const pages = (await listPages(hotel.id)).filter((p) => p.published);
  const blocks: Block[] = pages.flatMap((p) => p.blocks);
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder));
  const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true)));
  const T = (v: Parameters<typeof tr>[0]) => plainText(tr(v, lang));
  const exs = await db().select().from(extras).where(and(eq(extras.hotelId, hotel.id), eq(extras.active, true))).orderBy(asc(extras.sortOrder));
  const planMin = new Map(rps.map((p) => [p.id, p.minNights]));
  return {
    hotel: {
      name: hotel.name,
      address: [hotel.addressLine, [hotel.postalCode, hotel.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      email: hotel.contactEmail, phone: hotel.contactPhone, checkin: hotel.checkinTime.slice(0, 5), checkout: hotel.checkoutTime.slice(0, 5),
    },
    rooms: rts.map((r) => ({
      name: roomName(r, lang), description: roomDescription(r, lang), maxGuests: r.maxOccupancy,
      plans: rps.filter((p) => p.roomTypeId === r.id).map((p) => ({ name: planName(p, lang), breakfast: p.breakfastIncluded, minNights: p.minNights, cancellation: cancellationPolicyText(p, lang) })),
    })),
    faq: blocks.flatMap((b) => (b.type === "faq" ? b.items : [])).map((x) => ({ q: T(x.q), a: T(x.a) })).filter((x) => x.q),
    tips: blocks.flatMap((b) => (b.type === "tips" ? b.items : [])).map((x) => ({ title: T(x.title), text: T(x.text), category: x.category, season: x.season, distance: T(x.distance), url: x.url })).filter((x) => x.title),
    facts: blocks.flatMap((b) => (b.type === "facts" ? b.items : [])).map((x) => ({ label: T(x.label), value: T(x.value) })).filter((x) => x.label),
    arrival: blocks.flatMap((b) => (b.type === "location" ? [T(b.body)] : [])).filter(Boolean),
    extras: exs.map((e) => ({ name: T(e.name), description: T(e.description), priceChf: (e.priceRappen / 100).toFixed(2), unit: e.unit, mandatory: e.mandatory })),
    menu: blocks.flatMap((b) => (b.type === "menu" ? b.items : [])).map((x) => ({ section: T(x.section), name: T(x.name), text: T(x.text), priceChf: x.priceRappen === null ? null : (x.priceRappen / 100).toFixed(2), diet: x.diet, glutenFree: x.glutenFree })).filter((x) => x.name),
    hours: blocks.flatMap((b) => (b.type === "hours" ? [{ place: b.place, title: T(b.heading), days: b.days, closures: b.closures.map((c) => ({ from: c.from, to: c.to, label: T(c.label) })) }] : [])),
    offers: blocks.flatMap((b) => (b.type === "offers" ? b.items : [])).map((x) => ({ title: T(x.title), text: T(x.text), price: T(x.price), minNights: x.ratePlanId ? planMin.get(x.ratePlanId) ?? x.nights : x.nights })).filter((x) => x.title),
  };
}
