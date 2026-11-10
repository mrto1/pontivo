import { platformInfo, type LegalDoc } from "./texts";
import { formatChf } from "../domain/money";

/**
 * Bedingungen für Gastgeber (Vertrag zwischen Pontivo und dem Betrieb), Entwurf.
 * Wird bei der Selbst-Registrierung akzeptiert (hotels.host_terms_version/_accepted_at).
 * WICHTIG: Vor dem produktiven Einsatz juristisch prüfen lassen (QUESTIONS.md). Inklusive Auftragsbearbeitung (DSG).
 */
// ASSUMPTION: Nur Deutsch; französische und italienische Fassung folgen nach der juristischen Prüfung.
export const HOST_TERMS_VERSION = "2026-11-10";
export const DEFAULT_MONTHLY_MINIMUM_RAPPEN = 1900;

export function hostTerms(): LegalDoc {
  const p = platformInfo();
  const min = formatChf(DEFAULT_MONTHLY_MINIMUM_RAPPEN);
  return {
    title: `Bedingungen für Gastgeber – ${p.name}`,
    intro: `Diese Bedingungen regeln die Nutzung von ${p.name} durch Hotels, B&Bs, Ferienwohnungen und weitere Beherbergungsbetriebe («Gastgeber»). Anbieterin ist ${p.operator} («${p.name}»), Adresse siehe Impressum.`,
    draftNote: "Entwurf – noch nicht juristisch geprüft.",
    sections: [
      { h: "1. Leistungen", p: [
        `${p.name} stellt eine Website mit Online-Buchung, Zahlungsabwicklung über Stripe, Verwaltung von Zimmern/Wohnungen, Preisen und Buchungen sowie optionale Module (z. B. Gästemeldung, Gutscheine, Abgleich mit Buchungsportalen über Channex) zur Verfügung.`,
        "Der Gastgeber ist Vertragspartner seiner Gäste. Er ist verantwortlich für seine Inhalte, Preise, Stornoregeln, Kurtaxe, Gästemeldung und die Einhaltung der für ihn geltenden Vorschriften (z. B. Bewilligungen, Preisbekanntgabe, Lebensmittelrecht).",
      ] },
      { h: "2. Preis", p: [
        `Pro Direktbuchung und pro verkauftem Gutschein: 1 % des per Karte, TWINT oder Wallet bezahlten Betrags. Die Gebühr wird bei der Zahlung direkt einbehalten und bei einer Rückerstattung anteilig zurückgegeben.`,
        `Mindestgebühr: ${min} pro Kalendermonat. Liegen die 1 % eines Monats darunter, wird die Differenz Anfang des Folgemonats der hinterlegten Karte belastet. Die Mindestgebühr gilt ab dem ersten vollen Kalendermonat nach der Live-Schaltung, auch in Monaten, in denen der Betrieb pausiert ist.`,
        "Gebühren von Stripe (Zahlungsabwicklung) trägt der Gastgeber direkt gegenüber Stripe. Die Website und automatische Übersetzungen im Rahmen der angegebenen Grenzen sind inbegriffen.",
        "Preise verstehen sich ohne Mehrwertsteuer, sofern diese geschuldet ist. Preisänderungen werden mindestens 60 Tage im Voraus per E-Mail angekündigt; der Gastgeber kann auf den Zeitpunkt der Änderung kündigen.",
      ] },
      { h: "3. Zahlungsabwicklung", p: [
        "Zahlungen der Gäste gehen direkt auf das Stripe-Konto des Gastgebers. Dafür schliesst der Gastgeber einen eigenen Vertrag mit Stripe ab (Stripe Connected Account Agreement).",
        `${p.name} speichert keine Kartendaten. Für die Mindestgebühr hinterlegt der Gastgeber eine Karte bei Stripe; ${p.name} kennt nur Kartentyp und die letzten vier Ziffern.`,
        "Scheitert eine Belastung, wird der Gastgeber per E-Mail informiert und kann die Karte im Admin erneuern. Bleibt eine Forderung länger als 30 Tage offen, darf die Online-Buchung pausiert werden.",
      ] },
      { h: "4. Daten", p: [
        `${p.name} bearbeitet Personendaten der Gäste im Auftrag des Gastgebers (Auftragsbearbeitung nach Art. 9 DSG) und nur für die Erbringung der Leistungen. Daten werden in der Schweiz bzw. bei ${p.hosting} gespeichert. Unterauftragsbearbeiter: Stripe (Zahlungen), Postmark (E-Mail), Channex (bei Portal-Abgleich), Anthropic (automatische Übersetzung von Hotel-Texten, ohne Gastdaten).`,
        "Der Gastgeber ist für die Rechtmässigkeit der Bearbeitung gegenüber seinen Gästen verantwortlich und informiert sie mit der bereitgestellten Datenschutzerklärung.",
      ] },
      { h: "5. Verfügbarkeit und Haftung", p: [
        `${p.name} betreibt die Plattform mit der üblichen Sorgfalt, garantiert aber keine ununterbrochene Verfügbarkeit. Für Überbuchungen durch fehlerhafte Angaben des Gastgebers oder Ausfälle Dritter (z. B. Buchungsportale, Stripe) haftet ${p.name} nicht.`,
        `Die Haftung von ${p.name} ist, soweit gesetzlich zulässig, auf die in den letzten zwölf Monaten bezahlten Gebühren beschränkt; ausgenommen sind Vorsatz und grobe Fahrlässigkeit.`,
      ] },
      { h: "6. Laufzeit und Kündigung", p: [
        "Der Vertrag läuft unbefristet und kann von beiden Seiten mit 30 Tagen Frist auf Ende eines Monats per E-Mail gekündigt werden. Bestehende Buchungen werden bis zur Abreise abgewickelt.",
        "Nach Vertragsende kann der Gastgeber seine Buchungs- und Gästedaten während 30 Tagen exportieren; danach werden sie gelöscht, soweit keine gesetzliche Aufbewahrungspflicht besteht.",
      ] },
      { h: "7. Schlussbestimmungen", p: [
        `Änderungen dieser Bedingungen werden mindestens 30 Tage im Voraus per E-Mail mitgeteilt. Es gilt Schweizer Recht. Gerichtsstand ist der Sitz von ${p.name}.`,
      ] },
    ],
  };
}
