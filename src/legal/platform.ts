import { platformInfo, type LegalDoc } from "./texts";
import { env } from "../env";

/**
 * Impressum und Datenschutzerklärung der Plattform-Website (pontivo.ch) selbst – nicht der Hotel-Websites.
 * Entwurf, juristisch prüfen lassen (QUESTIONS.md).
 */
export const PLATFORM_LEGAL_VERSION = "2026-11-10";

export function platformImprint(): LegalDoc {
  const p = platformInfo();
  const e = env();
  return {
    title: "Impressum",
    intro: `${p.name} ist ein Angebot von:`,
    draftNote: "",
    sections: [
      { h: "Anbieter", p: [p.operator, p.address, `E-Mail: ${p.email}`, ...(e.PLATFORM_PHONE ? [`Telefon: ${e.PLATFORM_PHONE}`] : [])] },
      { h: "Rechtsform", p: ["Einzelunternehmen nach Schweizer Recht. Nicht im Handelsregister eingetragen, nicht mehrwertsteuerpflichtig."] },
      { h: "Haftung für Inhalte und Links", p: [
        "Die Inhalte dieser Website werden mit Sorgfalt erstellt. Für Richtigkeit, Vollständigkeit und Aktualität übernehmen wir keine Gewähr. Für Inhalte verlinkter fremder Websites sind ausschliesslich deren Betreiber verantwortlich.",
        "Auf den Websites der Hotels und Ferienwohnungen, die mit Pontivo erstellt sind, ist der jeweilige Betrieb für Inhalte, Preise und Leistungen verantwortlich; das Impressum des Betriebs steht auf dessen Website.",
      ] },
    ],
  };
}

export function platformPrivacy(): LegalDoc {
  const p = platformInfo();
  return {
    title: "Datenschutzerklärung",
    intro: `Diese Erklärung gilt für die Website ${p.name} (Informationen, Registrierung und Admin-Bereich für Gastgeber). Für Buchungen auf den Websites der Betriebe gilt deren eigene Datenschutzerklärung; dort bearbeitet ${p.name} Daten im Auftrag des Betriebs.`,
    draftNote: "Entwurf – noch nicht juristisch geprüft.",
    sections: [
      { h: "1. Verantwortlich", p: [`${p.operator}, E-Mail ${p.email}. Postadresse siehe Impressum.`] },
      { h: "2. Welche Daten wir bearbeiten", p: [
        "Besuch der Website: Der Server speichert technisch nötige Angaben (IP-Adresse, Zeitpunkt, aufgerufene Seite, Browser) in Protokollen, um den Betrieb und die Sicherheit zu gewährleisten. Protokolle werden nach höchstens 30 Tagen gelöscht.",
        "Kontakt per E-Mail oder Telefon: Ihre Angaben und Ihre Nachricht, um Ihre Anfrage zu beantworten.",
        "Registrierung und Nutzung als Gastgeber: Name, E-Mail, Angaben zum Betrieb, Login-Zeitpunkte und Änderungen im Admin (Protokoll), um den Vertrag zu erfüllen und die Plattform sicher zu betreiben.",
        "Zahlungen: Für die monatliche Mindestgebühr hinterlegen Gastgeber eine Karte bei Stripe. Wir erhalten nur Kartentyp und die letzten vier Ziffern, nie die vollständigen Kartendaten.",
      ] },
      { h: "3. Cookies und Tracking", p: [
        "Wir verwenden keine Werbe- oder Analyse-Cookies und kein Tracking. Nach dem Login im Admin-Bereich setzen wir ein technisch nötiges Sitzungs-Cookie.",
      ] },
      { h: "4. Empfänger und Speicherort", p: [
        `Hosting: ${p.hosting}. E-Mail-Versand: Postmark (Wildbit/ActiveCampaign, USA). Zahlungen: Stripe Payments Europe Ltd. (Irland) bzw. Stripe, Inc. (USA). Bei Übermittlung in Länder ohne angemessenen Datenschutz stützen wir uns auf anerkannte Garantien (z. B. Swiss-U.S. Data Privacy Framework oder Standardvertragsklauseln).`,
        "Wir verkaufen keine Daten und geben sie nur weiter, wenn es für die Leistung nötig ist oder das Gesetz es verlangt.",
      ] },
      { h: "5. Aufbewahrung", p: [
        "Daten von Gastgebern bewahren wir für die Dauer des Vertrags auf, danach während 30 Tagen für den Export und anschliessend nur, soweit gesetzliche Pflichten es verlangen (z. B. Buchhaltung 10 Jahre).",
      ] },
      { h: "6. Ihre Rechte", p: [
        `Sie können Auskunft über Ihre Daten verlangen sowie Berichtigung, Löschung oder Herausgabe. Schreiben Sie an ${p.email}. Sie können sich zudem beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) beschweren.`,
      ] },
      { h: "7. Änderungen", p: [`Stand: ${PLATFORM_LEGAL_VERSION}. Wir passen diese Erklärung an, wenn sich unsere Bearbeitung ändert.`] },
    ],
  };
}
