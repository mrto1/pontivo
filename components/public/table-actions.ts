"use server";
import { redirect } from "next/navigation";
import { getHotelById } from "@/src/services/hotels";
import { PosError } from "@/src/services/pos";
import { cancelByToken, createReservation, joinWaitlist } from "@/src/services/reservations";
import { isLocale } from "@/src/i18n/dict";
import { s } from "@/src/lib/form";

/** Nur die beiden eigenen Pfadformen zulassen (kein Umleiten auf fremde Adressen) */
const baseOf = (f: FormData) => (/^\/h\/[a-z0-9-]+$/.test(s(f, "base")) ? s(f, "base") : "");

/** Gast reserviert (öffentliches Formular). Hotel nur über die Id im Formular; Rate-Limit-frei, aber Kapazität und Fenster prüft der Dienst. */
export async function reserveAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const base = baseOf(f);
  const hotel = await getHotelById(s(f, "hotelId"));
  if (!hotel) redirect("/");
  const here = (extra: string) => redirect(`${base}/${locale}/tisch?date=${encodeURIComponent(s(f, "day"))}&party=${encodeURIComponent(s(f, "party"))}${extra}`);
  if (s(f, "website")) redirect(`${base}/${locale}`); // Honigtopf gegen Bots
  let token = "";
  let redirectTo = "";
  try {
    const preorder = [...f.entries()].filter(([k]) => k.startsWith("p_")).map(([k, v]) => ({ itemId: k.slice(2), quantity: Math.floor(Number(v) || 0), optionIds: [] as string[], note: "" })).filter((l) => l.quantity > 0);
    const r = await createReservation(hotel, { day: s(f, "day"), time: s(f, "time"), party: Number(s(f, "party")), name: s(f, "name"), phone: s(f, "phone"), email: s(f, "email"), note: s(f, "note"), language: locale, preorder }, "online", "guest");
    token = r.reservation.publicToken;
    if (r.checkoutUrl) redirectTo = r.checkoutUrl;
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    here(`&msg=${encodeURIComponent(e.message)}`);
  }
  if (redirectTo) redirect(redirectTo); // Zahlungsseite von Stripe
  redirect(`${base}/${locale}/tisch/${token}?new=1`);
}

/** Gast trägt sich auf die Warteliste ein */
export async function waitlistAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const base = baseOf(f);
  const hotel = await getHotelById(s(f, "hotelId"));
  if (!hotel) redirect("/");
  if (s(f, "website")) redirect(`${base}/${locale}`);
  const back = `${base}/${locale}/tisch?date=${encodeURIComponent(s(f, "day"))}&party=${encodeURIComponent(s(f, "party"))}`;
  try { await joinWaitlist(hotel, { day: s(f, "day"), party: Number(s(f, "party")), name: s(f, "name"), email: s(f, "email"), language: locale }); }
  catch (e) { if (!(e instanceof PosError)) throw e; redirect(`${back}&msg=${encodeURIComponent(e.message)}`); }
  redirect(`${back}&wait=1`);
}

export async function cancelReservationAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const token = s(f, "token");
  try { await cancelByToken(token); } catch (e) { if (!(e instanceof PosError)) throw e; }
  redirect(`${baseOf(f)}/${locale}/tisch/${token}?cancelled=1`);
}
