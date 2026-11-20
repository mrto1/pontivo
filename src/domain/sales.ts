/** Vertriebs-Cockpit (SPEC 19.31), reine Logik: Status, Mail-Vorlagen, Trichter */

export const LEAD_STATUSES = ["neu", "kontaktiert", "demo", "angebot", "gewonnen", "verloren"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { neu: "Neu", kontaktiert: "Kontaktiert", demo: "Demo / Gespräch", angebot: "Angebot", gewonnen: "Gewonnen", verloren: "Verloren" };

export const LEAD_SOURCES = ["manuell", "registrierung", "empfehlung", "messe", "anfrage"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = { manuell: "Von Hand", registrierung: "Selbst registriert", empfehlung: "Empfehlung", messe: "Messe / Anlass", anfrage: "Anfrage" };

export const isOpenStatus = (s: LeadStatus) => s !== "gewonnen" && s !== "verloren";

export type MailTemplate = { id: string; label: string; subject: string; body: string; /** Status nach dem Senden, wenn der Lead noch «neu» ist */ moves?: LeadStatus };

/**
 * Vorlagen für persönliche Nachrichten an einzelne Interessenten (kein Massenversand). Platzhalter: {kontakt}, {betrieb}, {absender}, {plattform}.
 * ASSUMPTION: Nur sachliche Texte ohne Preisversprechen ausser dem öffentlichen Preismodell; Texte vor dem Einsatz prüfen.
 */
export const MAIL_TEMPLATES: MailTemplate[] = [
  {
    id: "erstkontakt", label: "Erstkontakt", moves: "kontaktiert",
    subject: "Direktbuchung für {betrieb}",
    body: "Guten Tag {kontakt}\n\n{plattform} ist eine Direktbuchung für kleine Hotels und Ferienwohnungen in der Schweiz: Website, Buchung, Zahlung mit TWINT und Karte, Abgleich mit Booking.com. Sie zahlen nur, wenn tatsächlich gebucht wird.\n\nIch zeige Ihnen gern in 20 Minuten, wie {betrieb} damit aussehen würde. Passt Ihnen ein kurzes Gespräch diese oder nächste Woche?\n\nFreundliche Grüsse\n{absender}",
  },
  {
    id: "nach-gespraech", label: "Nach dem Gespräch",
    subject: "Danke für das Gespräch, {betrieb}",
    body: "Guten Tag {kontakt}\n\nVielen Dank für Ihre Zeit. Wie besprochen können Sie {plattform} unverbindlich selbst ausprobieren: Registrierung und Einrichtung dauern etwa 20 Minuten, ohne Einrichtungsgebühr und ohne Mindestlaufzeit.\n\nWenn Sie möchten, richte ich es gemeinsam mit Ihnen ein. Melden Sie sich einfach mit einem Terminvorschlag.\n\nFreundliche Grüsse\n{absender}",
  },
  {
    id: "nachfassen", label: "Nachfassen",
    subject: "Kurze Rückfrage zu {betrieb}",
    body: "Guten Tag {kontakt}\n\nIch wollte kurz nachfragen, ob Sie sich {plattform} anschauen konnten und ob ich Ihnen noch etwas zeigen oder beantworten kann.\n\nWenn es gerade nicht passt, sagen Sie es mir ruhig. Ich melde mich dann nicht mehr.\n\nFreundliche Grüsse\n{absender}",
  },
  {
    id: "einrichtung", label: "Hilfe bei der Einrichtung",
    subject: "Brauchen Sie Hilfe bei der Einrichtung von {betrieb}?",
    body: "Guten Tag {kontakt}\n\nSie haben {betrieb} bei {plattform} angelegt, die Einrichtung ist aber noch nicht abgeschlossen. Oft fehlt nur ein kleiner Schritt (Zimmer, Preise oder das Stripe-Konto).\n\nGern gehe ich das 15 Minuten mit Ihnen durch, per Telefon oder Video. Sagen Sie mir, wann es passt.\n\nFreundliche Grüsse\n{absender}",
  },
];

export const templateById = (id: string) => MAIL_TEMPLATES.find((t) => t.id === id);

export function fillTemplate(text: string, v: { kontakt?: string; betrieb: string; absender: string; plattform: string }): string {
  const vars: Record<string, string> = { kontakt: v.kontakt?.trim() || "", betrieb: v.betrieb, absender: v.absender, plattform: v.plattform };
  const out = text.replace(/\{(kontakt|betrieb|absender|plattform)\}/g, (_, k: string) => vars[k]);
  // ohne Kontaktname: «Guten Tag »  →  «Guten Tag»
  return out.replace(/Guten Tag +\n/g, "Guten Tag\n").replace(/Guten Tag +$/gm, "Guten Tag");
}

export type Funnel = { counts: Record<LeadStatus, number>; open: number; won: number; lost: number; /** gewonnen / (gewonnen + verloren), null ohne Abschluss */ winRate: number | null };

export function funnelOf(statuses: LeadStatus[]): Funnel {
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const s of statuses) counts[s]++;
  const closed = counts.gewonnen + counts.verloren;
  return { counts, open: statuses.filter(isOpenStatus).length, won: counts.gewonnen, lost: counts.verloren, winRate: closed ? counts.gewonnen / closed : null };
}

/** Offener Lead mit fälligem nächstem Schritt (heute oder früher) */
export const isDue = (l: { status: LeadStatus; nextActionAt: string | null }, today: string) => isOpenStatus(l.status) && !!l.nextActionAt && l.nextActionAt <= today;
