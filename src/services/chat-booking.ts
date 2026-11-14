import { addDays, diffDays, isDay } from "../domain/dates";
import { formatChf } from "../domain/money";
import { searchOffers } from "./search";
import { publicBase } from "./brand";
import { isBookable } from "./hotels";
import { env } from "../env";
import type { Hotel } from "../db/schema";
import type { Locale } from "../i18n/dict";

/**
 * Buchender KI-Chat (SPEC 14f). Das Modell ruft Werkzeuge auf; Verfügbarkeit und Preise kommen ausschliesslich aus
 * searchOffers() auf dem Server. Eine Angebotskarte wird vom Server erzeugt (nie vom Modell) und führt auf das
 * normale Buchungsformular (Name, AGB, Zahlung). Im Chat werden keine Personendaten erfasst.
 */

export type OfferCard = { room: string; plan: string; checkin: string; checkout: string; nights: number; adults: number; children: number; totalRappen: number; total: string; cancellation: string; href: string };

export const BOOKING_TOOLS = [
  {
    name: "check_stay",
    description: "Check availability and the total price for a stay. Returns bookable options with server-calculated total prices in CHF. Only call after the guest gave arrival date, departure date and number of guests.",
    input_schema: {
      type: "object",
      properties: {
        checkin: { type: "string", description: "Arrival date YYYY-MM-DD" },
        checkout: { type: "string", description: "Departure date YYYY-MM-DD" },
        adults: { type: "integer", minimum: 1, maximum: 10 },
        children: { type: "integer", minimum: 0, maximum: 10 },
        children_ages: { type: "array", items: { type: "integer", minimum: 0, maximum: 17 }, description: "One age per child, only if required" },
      },
      required: ["checkin", "checkout", "adults"],
    },
  },
  {
    name: "show_offer",
    description: "Show the guest a booking card for one option returned by check_stay. Pass option_id exactly as returned. The guest then books on the card.",
    input_schema: { type: "object", properties: { option_id: { type: "string" } }, required: ["option_id"] },
  },
] as const;

/** Chat bucht nur, wenn das Hotel es will und Online-Zahlung eingerichtet ist */
export function chatBookingAvailable(hotel: Hotel, enabled: boolean | undefined): boolean {
  return !!enabled && isBookable(hotel, env().PAYMENT_PROVIDER);
}

type Opt = { checkin: string; checkout: string; adults: number; children: number; ages: number[]; roomTypeId: string; ratePlanId: string };

/** option_id trägt alles Nötige; der Server prüft beim Anzeigen alles neu */
export const encodeOption = (o: Opt) => [o.checkin, o.checkout, o.adults, o.children, o.ages.join("."), o.roomTypeId, o.ratePlanId].join("|");
export function decodeOption(id: string): Opt | null {
  const p = String(id).split("|");
  if (p.length !== 7 || !isDay(p[0]) || !isDay(p[1])) return null;
  const adults = Number(p[2]), children = Number(p[3]);
  const ages = p[4] ? p[4].split(".").map(Number) : [];
  const uuid = /^[0-9a-f-]{36}$/;
  if (!Number.isInteger(adults) || !Number.isInteger(children) || adults < 1 || adults > 10 || children < 0 || children > 10 || ages.some((a) => !Number.isInteger(a) || a < 0 || a > 17) || !uuid.test(p[5]) || !uuid.test(p[6])) return null;
  return { checkin: p[0], checkout: p[1], adults, children, ages, roomTypeId: p[5], ratePlanId: p[6] };
}

type Input = Record<string, unknown>;

export async function runBookingTool(hotel: Hotel, lang: Locale, name: string, input: Input, now = new Date()): Promise<{ result: unknown; card?: OfferCard }> {
  if (name === "check_stay") {
    const checkin = String(input.checkin ?? ""), checkout = String(input.checkout ?? "");
    const adults = Number(input.adults ?? 2), children = Number(input.children ?? 0);
    const ages = Array.isArray(input.children_ages) ? input.children_ages.map(Number) : [];
    if (!isDay(checkin) || !isDay(checkout) || !Number.isInteger(adults) || !Number.isInteger(children) || adults < 1 || adults > 10 || children < 0 || children > 10) return { result: { error: "invalid_input" } };
    if (diffDays(checkin, checkout) > 60 || checkout > addDays(checkin, 60)) return { result: { error: "stay_too_long" } };
    const res = await searchOffers(hotel, { checkin, checkout, adults, children, childrenAges: ages.length === children ? ages : undefined }, { lang, now });
    if (!res.ok) return { result: { error: res.error } }; // z. B. child_ages_required, Datum in der Vergangenheit, Mindestaufenthalt
    if (!res.offers.length) return { result: { available: false, note: "No bookable option for these dates and guests." } };
    return {
      result: {
        available: true,
        nights: diffDays(checkin, checkout),
        options: res.offers.slice(0, 5).map((o) => ({
          option_id: encodeOption({ checkin, checkout, adults, children, ages: ages.length === children ? ages : [], roomTypeId: o.roomType.id, ratePlanId: o.ratePlan.id }),
          room: o.roomType.name, plan: o.ratePlan.name, breakfast_included: o.ratePlan.breakfastIncluded,
          total_chf: formatChf(o.totalRappen), cancellation: o.cancellationPolicy,
        })),
      },
    };
  }
  if (name === "show_offer") {
    const o = decodeOption(String(input.option_id ?? ""));
    if (!o) return { result: { error: "invalid_option" } };
    // Alles neu prüfen: Preis und Verfügbarkeit gelten jetzt, nicht beim ersten Aufruf
    const res = await searchOffers(hotel, { checkin: o.checkin, checkout: o.checkout, adults: o.adults, children: o.children, childrenAges: o.ages.length === o.children ? o.ages : undefined }, { lang, now, roomTypeId: o.roomTypeId, ratePlanId: o.ratePlanId });
    const offer = res.ok ? res.offers[0] : undefined;
    if (!offer) return { result: { error: "no_longer_available" } };
    const href = `${publicBase(hotel)}/${lang}/book?checkin=${o.checkin}&checkout=${o.checkout}&adults=${o.adults}&children=${o.children}${o.ages.length ? `&ages=${o.ages.join(",")}` : ""}&plan=${o.ratePlanId}`;
    const card: OfferCard = {
      room: offer.roomType.name, plan: offer.ratePlan.name, checkin: o.checkin, checkout: o.checkout, nights: diffDays(o.checkin, o.checkout), adults: o.adults, children: o.children,
      totalRappen: offer.totalRappen, total: formatChf(offer.totalRappen), cancellation: offer.cancellationPolicy, href,
    };
    return { result: { shown: true, total_chf: card.total, note: "The booking card is now visible to the guest. They complete the booking there." }, card };
  }
  return { result: { error: "unknown_tool" } };
}
