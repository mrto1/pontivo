import type { PortalI18n, PortalSettings } from "../db/schema";
import { tr } from "./blocks";

/** Gästeportal (SPEC 19.13): Kalendereintrag zur Buchung. Reine Logik. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (d: string) => d.replace(/-/g, "");

/** Zeilen auf höchstens 75 Oktette falten (RFC 5545), ohne ein UTF-8-Zeichen zu zerschneiden */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export type IcsInput = { reference: string; hotelName: string; address: string; checkin: string; checkout: string; checkinTime: string; description: string; now?: Date };

/** Ganztägiger Eintrag von Anreise bis Abreise (DTEND ist der Abreisetag, exklusiv) */
export function bookingIcs(i: IcsInput): string {
  const stamp = (i.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pontivo//Gaesteportal//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${i.reference}@pontivo`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(i.checkin)}`, `DTEND;VALUE=DATE:${compact(i.checkout)}`,
    `SUMMARY:${esc(i.hotelName)}`, ...(i.address ? [`LOCATION:${esc(i.address)}`] : []), `DESCRIPTION:${esc(i.description)}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}


/**
 * Gästeportal (SPEC 19.41): Wunschliste, Tipps und Sichtbarkeit des Türcodes. Reine Logik ohne I/O.
 */
export const PORTAL_LOCALES = ["de", "en", "fr", "it", "nl"] as const;

/** Standardliste, wenn der Betrieb nichts eingestellt hat (er kann sie abwählen und eigene Wünsche ergänzen) */
export const STANDARD_WISHES: { id: string; label: Required<PortalI18n> }[] = [
  { id: "late_checkout", label: { de: "Später auschecken (Late Check-out)", en: "Late check-out", fr: "Départ tardif", it: "Check-out tardivo", nl: "Laat uitchecken" } },
  { id: "early_checkin", label: { de: "Früher einchecken (Early Check-in)", en: "Early check-in", fr: "Arrivée anticipée", it: "Check-in anticipato", nl: "Vroeg inchecken" } },
  { id: "towels", label: { de: "Zusätzliche Handtücher", en: "Extra towels", fr: "Serviettes supplémentaires", it: "Asciugamani in più", nl: "Extra handdoeken" } },
  { id: "pillow", label: { de: "Zusätzliches Kissen oder Decke", en: "Extra pillow or blanket", fr: "Oreiller ou couverture supplémentaire", it: "Cuscino o coperta in più", nl: "Extra kussen of deken" } },
  { id: "baby_bed", label: { de: "Babybett", en: "Baby cot", fr: "Lit bébé", it: "Culla", nl: "Babybed" } },
  { id: "quiet_room", label: { de: "Ruhiges Zimmer", en: "Quiet room", fr: "Chambre calme", it: "Camera tranquilla", nl: "Rustige kamer" } },
];

export const MAX_WISHES = 20;
export const MAX_TIPS = 40;
/** Pro Buchung höchstens so viele offene Wünsche und so viele Wünsche insgesamt (Schutz vor Missbrauch des offenen Links) */
export const MAX_OPEN_REQUESTS = 5;
export const MAX_REQUESTS_PER_BOOKING = 20;

export type WishOption = { id: string; label: PortalI18n };

export const requestsEnabled = (p: PortalSettings | undefined): boolean => p?.requests !== false;
export const folioEnabled = (p: PortalSettings | undefined): boolean => p?.folio !== false;
export const selfCheckoutEnabled = (p: PortalSettings | undefined): boolean => p?.selfCheckout !== false;
export const doorCodeEnabled = (p: PortalSettings | undefined): boolean => p?.doorCode !== false;

export function wishOptions(p: PortalSettings | undefined): WishOption[] {
  return p?.wishes ?? STANDARD_WISHES;
}

export const wishLabel = (o: WishOption, lang: string): string => tr(o.label, lang as never).trim() || o.id;

/**
 * Türcode im Portal sichtbar? Nur wenn: Betrieb zeigt ihn, Code aktiv und nicht abgelaufen/widerrufen, jetzt zwischen
 * Gültigkeitsbeginn und -ende, Anreisetag erreicht und – falls das Modul Online-Check-in läuft – der Check-in ausgefüllt ist.
 * `checkinRequired` = Modul «Gäste» an. Reine Anzeige: der Code selbst funktioniert am Schloss nur im Gültigkeitsfenster.
 */
export function doorCodeVisible(i: {
  enabled: boolean; status: string; validFrom: Date; validUntil: Date; now: Date; today: string; checkin: string; checkout: string;
  checkinRequired: boolean; checkinDone: boolean; bookingConfirmed: boolean;
}): boolean {
  if (!i.enabled || !i.bookingConfirmed || i.status !== "active") return false;
  if (i.now < i.validFrom || i.now > i.validUntil) return false;
  if (i.today < i.checkin || i.today > i.checkout) return false;
  return !i.checkinRequired || i.checkinDone;
}

/** Selbst auschecken: bestätigte Buchung, am Abreisetag (Hotelzeit), noch nicht ausgecheckt */
export function selfCheckoutOpen(b: { status: string; checkout: string; guestCheckoutAt: Date | null }, today: string, enabled: boolean): boolean {
  return enabled && b.status === "confirmed" && today === b.checkout && !b.guestCheckoutAt;
}
