import { tr } from "../domain/blocks";
import { todayIn } from "../domain/dates";
import type { Locale } from "../i18n/dict";
import { getBookingByToken } from "./bookings";

/**
 * Ankunftsinfos (Schlüsselcode, WLAN …) für einen Gast (SPEC 14b). Nur mit gültigem Buchungslink, bestätigter Buchung und
 * während des Aufenthalts (Anreisetag bis Abreisetag, Hotelzeit). Der Text des Zimmertyps überschreibt den allgemeinen des Hotels.
 * Die Infos gehen nie in KI-Prompts: sie werden hier direkt aus der Datenbank gelesen und fest angezeigt.
 */
type Found = NonNullable<Awaited<ReturnType<typeof getBookingByToken>>>;

export function arrivalAllowed(f: Pick<Found, "booking" | "hotel">, now = new Date()): boolean {
  if (f.booking.status !== "confirmed") return false;
  const today = todayIn(f.hotel.timezone, now);
  return today >= f.booking.checkin && today <= f.booking.checkout;
}

export function arrivalText(f: Pick<Found, "hotel" | "roomType">, lang: Locale): string {
  return (f.roomType?.arrivalInfo ?? "").trim() || tr(f.hotel.content.arrivalInfo, lang).trim();
}

export type ArrivalResult = { status: "ok"; text: string } | { status: "not_allowed" };

export async function arrivalForToken(token: string, lang: Locale, hotelId?: string, now = new Date()): Promise<ArrivalResult> {
  const f = await getBookingByToken(token);
  if (!f || (hotelId && f.hotel.id !== hotelId) || !arrivalAllowed(f, now)) return { status: "not_allowed" };
  return { status: "ok", text: arrivalText(f, lang) };
}
