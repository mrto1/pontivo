import type { Booking, Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";
import { doorCodeEnabled, doorCodeVisible, folioEnabled } from "../domain/portal";
import { codesOfBooking } from "./door-access";
import { guestsModuleEnabled, checkinContext } from "./guests";
import { bookingBalance, listFolio } from "./invoicing";
import { db } from "../db/client";
import { moduleOn } from "./modules";

/**
 * Gästeportal (SPEC 19.41): was zur Buchung im Portal gezeigt wird. Alles nur mit gültigem Buchungslink, immer mit hotel_id der Buchung.
 */
export type PortalDoorCode = { lock: string; code: string; validUntil: Date };

/** Türcodes (Nuki): nur sichtbar, wenn der Betrieb es erlaubt, der Code aktiv und gültig ist und – bei laufendem Modul Gäste – der Online-Check-in ausgefüllt ist */
export async function portalDoorCodes(token: string, hotel: Hotel, booking: Booking, now = new Date()): Promise<{ codes: PortalDoorCode[]; waitingForCheckin: boolean }> {
  if (!doorCodeEnabled(hotel.content.portal) || booking.status !== "confirmed" || !(await moduleOn(hotel.id, "access"))) return { codes: [], waitingForCheckin: false };
  const all = (await codesOfBooking(hotel.id, booking.id)).filter((c) => c.status === "active" && c.code);
  if (!all.length) return { codes: [], waitingForCheckin: false };
  const required = await guestsModuleEnabled(hotel.id);
  const ci = required ? await checkinContext(token) : null;
  const today = todayIn(hotel.timezone, now);
  const visible = (c: (typeof all)[number], done: boolean) => doorCodeVisible({
    enabled: true, status: c.status, validFrom: c.validFrom, validUntil: c.validUntil, now, today, checkin: booking.checkin, checkout: booking.checkout,
    checkinRequired: required, checkinDone: done, bookingConfirmed: true,
  });
  const codes = all.filter((c) => visible(c, !!ci?.submitted)).map((c) => ({ lock: c.lockName, code: c.code as string, validUntil: c.validUntil }));
  // Hinweis «erst nach Check-in», wenn der Code sonst schon sichtbar wäre
  const waitingForCheckin = !codes.length && required && !ci?.submitted && all.some((c) => visible(c, true));
  return { codes, waitingForCheckin };
}

/** Rechnung bis jetzt: Posten aufs Zimmer (z. B. Restaurant) und offener Betrag, nur während des Aufenthalts */
export async function portalFolio(hotel: Hotel, booking: Booking, now = new Date()) {
  if (!folioEnabled(hotel.content.portal) || booking.status !== "confirmed") return null;
  const today = todayIn(hotel.timezone, now);
  if (today < booking.checkin || today > booking.checkout) return null;
  const items = await listFolio(hotel.id, booking.id);
  const bal = await bookingBalance(db(), hotel.id, booking.id);
  return { items, folioRappen: bal.folioRappen, totalRappen: bal.totalRappen, paidRappen: bal.paidRappen + bal.voucherRappen, openRappen: bal.openRappen };
}
