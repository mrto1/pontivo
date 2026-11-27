"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DRAFT_COOKIE } from "./reservation-draft";
import { getHotelById } from "@/src/services/hotels";
import { PosError } from "@/src/services/pos";
import { cancelByToken, createReservation, joinWaitlist } from "@/src/services/reservations";
import { isLocale } from "@/src/i18n/dict";
import { parseCartForm } from "./cart-form";
import { s } from "@/src/lib/form";
import { parseReferrer } from "@/src/domain/google";

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
    const preorder = parseCartForm(f);
    const r = await createReservation(hotel, { day: s(f, "day"), time: s(f, "time"), party: Number(s(f, "party")), name: s(f, "name"), phone: s(f, "phone"), email: s(f, "email"), note: s(f, "note"), language: locale, preorder, referrer: parseReferrer(s(f, "ref")) }, "online", "guest");
    token = r.reservation.publicToken;
    if (r.checkoutUrl) redirectTo = r.checkoutUrl;
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    // Eingaben für 10 Minuten aufbewahren, damit der Gast nach dem Hinweis nicht alles neu tippen muss (nicht in der Adresse: keine Kontaktdaten in Protokollen)
    const draft = { name: s(f, "name").slice(0, 80), email: s(f, "email").slice(0, 200), phone: s(f, "phone").slice(0, 40), note: s(f, "note").slice(0, 300), time: s(f, "time").slice(0, 5) };
    (await cookies()).set(DRAFT_COOKIE, encodeURIComponent(JSON.stringify(draft)), { maxAge: 600, httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    here(`&msg=${encodeURIComponent(e.message)}`);
  }
  (await cookies()).delete(DRAFT_COOKIE);
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
