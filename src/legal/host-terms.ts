import { platformInfo, type LegalDoc } from "./texts";
import { feePercentText } from "../domain/fee";
import { formatChf } from "../domain/money";

/**
 * Bedingungen für Gastgeber (Vertrag zwischen Pontivo und dem Betrieb).
 * Wird bei der Selbst-Registrierung akzeptiert (hotels.host_terms_version/_accepted_at).
 * WICHTIG: Vor dem produktiven Einsatz juristisch prüfen lassen (QUESTIONS.md). Inklusive Auftragsbearbeitung (DSG).
 */
// ASSUMPTION: Nur Deutsch; französische und italienische Fassung folgen nach der juristischen Prüfung.
export const HOST_TERMS_VERSION = "2026-11-14";
export const DEFAULT_MONTHLY_MINIMUM_RAPPEN = 1900;

export function hostTerms(): LegalDoc {
  const p = platformInfo();
  const min = formatChf(DEFAULT_MONTHLY_MINIMUM_RAPPEN);
  return {
    title: `Bedingungen für Gastgeber – ${p.name}`,
    intro: `Diese Bedingungen regeln die Nutzung von ${p.name} durch Hotels, B&Bs, Ferienwohnungen und weitere Beherbergungsbetriebe («Gastgeber»). Anbieterin ist ${p.operator} («${p.name}»), Adresse siehe Impressum.`,
    draftNote: "",
    sections: [
      { h: "1. Leistungen", p: [
        `${p.name} stellt eine Website mit Online-Buchung, Zahlungsabwicklung über Stripe, Verwaltung von Zimmern/Wohnungen, Preisen und Buchungen sowie optionale Module (z. B. Gästemeldung, Gutscheine, Abgleich mit Buchungsportalen über Channex) zur Verfügung.`,
        "Der Gastgeber ist Vertragspartner seiner Gäste. Er ist verantwortlich für seine Inhalte, Preise, Stornoregeln, Kurtaxe, Gästemeldung und die Einhaltung der für ihn geltenden Vorschriften (z. B. Bewilligungen, Preisbekanntgabe, Lebensmittelrecht).",
      ] },
      { h: "2. Preis", p: [
        `Pro Direktbuchung und pro verkauftem Gutschein: ${feePercentText()} % des per Karte, TWINT oder Wallet bezahlten Betrags. Die Gebühr wird bei der Zahlung direkt einbehalten und bei einer Rückerstattung anteilig zurückgegeben.`,
        `Mindestgebühr: ${min} pro Kalendermonat. Liegen die ${feePercentText()} % eines Monats darunter, wird die Differenz Anfang des Folgemonats der hinterlegten Karte belastet. Die Mindestgebühr gilt ab dem ersten vollen Kalendermonat nach der Live-Schaltung, auch in Monaten, in denen der Betrieb pausiert ist.`,
        "Gebühren von Stripe (Zahlungsabwicklung) trägt der Gastgeber direkt gegenüber Stripe. Die Website und automatische Übersetzungen im Rahmen der angegebenen Grenzen sind inbegriffen.",
        "Preise verstehen sich ohne Mehrwertsteuer, sofern diese geschuldet ist. Preiserhöhungen werden mindestens 60 Tage im Voraus per E-Mail angekündigt.",
        `Bei einer Preiserhöhung hat der Gastgeber ein Sonderkündigungsrecht: Er kann den Vertrag bis zum Inkrafttreten der Erhöhung per E-Mail mit Wirkung auf diesen Zeitpunkt kündigen, ohne die ordentliche Kündigungsfrist nach Ziffer 6 einhalten zu müssen. Kündigt er nicht, gilt der neue Preis ab dem angekündigten Zeitpunkt.`,
      ] },
      { h: "3. Zahlungsabwicklung", p: [
        "Zahlungen der Gäste gehen direkt auf das Stripe-Konto des Gastgebers. Dafür schliesst der Gastgeber einen eigenen Vertrag mit Stripe ab (Stripe Connected Account Agreement).",
        `${p.name} speichert keine Kartendaten. Für die Mindestgebühr hinterlegt der Gastgeber eine Karte bei Stripe; ${p.name} kennt nur Kartentyp und die letzten vier Ziffern.`,
        `Scheitert eine Belastung, wird der Gastgeber per E-Mail informiert und kann die Karte im Admin erneuern. Bleibt eine Forderung länger als 30 Tage offen, darf ${p.name} die Online-Buchung erst pausieren, nachdem sie den Gastgeber per E-Mail gemahnt und ihm eine Nachfrist von mindestens 14 Tagen gesetzt hat. Die Pausierung endet, sobald die offene Forderung bezahlt ist. Bereits bestätigte Buchungen bleiben davon unberührt.`,
      ] },
      { h: "4. Daten", p: [
        `${p.name} bearbeitet Personendaten der Gäste im Auftrag des Gastgebers (Auftragsbearbeitung nach Art. 9 DSG) und nur für die Erbringung der Leistungen. Daten werden in der Schweiz bzw. bei ${p.hosting} gespeichert. Unterauftragsbearbeiter: Stripe (Zahlungen), Postmark (E-Mail), Channex (bei Portal-Abgleich), Anthropic (USA; automatische Übersetzung von Hotel-Texten ohne Gastdaten und, nur bei eingeschaltetem Modul «KI-Chat», Verarbeitung der Chat-Nachrichten der Gäste ohne Speicherung; Übermittlung gestützt auf anerkannte Garantien, z. B. Swiss-US Data Privacy Framework oder Standardvertragsklauseln).`,
        "Der Gastgeber ist für die Rechtmässigkeit der Bearbeitung gegenüber seinen Gästen verantwortlich und informiert sie mit der bereitgestellten Datenschutzerklärung.",
      ] },
      { h: "5. Verfügbarkeit und Haftung", p: [
        `${p.name} betreibt die Plattform mit der im Geschäftsverkehr üblichen Sorgfalt, schuldet jedoch keine ununterbrochene Verfügbarkeit (insbesondere nicht bei Wartungsarbeiten oder höherer Gewalt). ${p.name} trifft angemessene Massnahmen zur Sicherung der Daten; der Gastgeber exportiert wichtige Daten (z. B. Buchungen) regelmässig selbst.`,
        `${p.name} haftet nicht für Schäden – insbesondere nicht für entgangenen Gewinn oder Überbuchungen –, die durch fehlerhafte Eingaben des Gastgebers oder durch Störungen, Ausfälle oder Änderungen bei unabhängigen Drittanbietern entstehen (z. B. Zahlungsdienstleister wie Stripe, Buchungsportale oder externe Schnittstellen wie Channex). Fehler in der eigenen Software von ${p.name}, auch in deren Anbindung an Drittanbieter, gelten nicht als Störung von Drittanbietern. Wird ${p.name} ein schwerwiegender Ausfall einer angebundenen Schnittstelle bekannt, informiert ${p.name} den Gastgeber im Rahmen des Zumutbaren.`,
        `Für eigene Vertragsverletzungen haftet ${p.name} – unabhängig vom Rechtsgrund – nur bei Vorsatz und grober Fahrlässigkeit. Die Haftung für leichte Fahrlässigkeit sowie für indirekte Schäden und Folgeschäden (wie entgangenen Gewinn) wird, soweit gesetzlich zulässig, ausgeschlossen. Sofern eine Haftung ausnahmsweise besteht, ist sie summenmässig auf die Gebühren beschränkt, die der Gastgeber in den letzten zwölf Monaten vor dem schädigenden Ereignis an ${p.name} bezahlt hat.`,
      ] },
      { h: "6. Laufzeit und Kündigung", p: [
        "Der Vertrag läuft unbefristet und kann von beiden Seiten mit 30 Tagen Frist auf Ende eines Monats per E-Mail gekündigt werden. Bestehende Buchungen werden bis zur Abreise abgewickelt.",
        "Nach Vertragsende kann der Gastgeber seine Buchungs- und Gästedaten während 30 Tagen exportieren; danach werden sie gelöscht, soweit keine gesetzliche Aufbewahrungspflicht besteht.",
      ] },
      { h: "7. Optionales Modul «KI-Chat»", p: [
        `Der Gastgeber kann das Modul «KI-Chat» im Admin einschalten. Es stellt auf seiner Website und auf der Buchungsseite der Gäste einen Chat bereit, der Fragen zum Haus und zur Umgebung ausschliesslich anhand der Inhalte des Gastgebers beantwortet. Der Chat nennt keine Zimmerpreise, prüft keine Verfügbarkeit und ändert keine Buchungen.`,
        `Preis und Umfang (Tarif, monatlicher Preis ohne Mehrwertsteuer, enthaltene Gespräche pro Monat, Zusatzpakete) zeigt ${p.name} vor dem Einschalten an; sie gelten ab der Bestätigung des Gastgebers und werden bei der Bestätigung festgehalten. Der erste Monat ist kostenlos. Der Preis wird zusammen mit den übrigen Gebühren monatlich der hinterlegten Karte belastet (Ziffer 3). Preisänderungen kündigt ${p.name} wie nach Ziffer 2 mit mindestens 60 Tagen Frist an; der Gastgeber kann das Modul bis dahin kündigen.`,
        `Ein Gespräch ist eine zusammenhängende Chat-Sitzung eines Gastes (Ende nach 30 Minuten Pause oder nach 20 Nachrichten). Ist das Kontingent des Monats aufgebraucht, pausiert der Chat bis Monatsende und bietet dem Gast an, die Frage an den Gastgeber weiterzuleiten. Zusatzpakete werden nur berechnet, wenn der Gastgeber sie mit einem Monatsbudget freigegeben hat; über das Budget hinaus wird nichts berechnet.`,
        `Das Modul ist jederzeit kündbar mit Wirkung auf Ende des laufenden Monats, unabhängig von der Kündigung des übrigen Vertrags.`,
        `Antworten des Chats werden mit Hilfe künstlicher Intelligenz erzeugt und können Fehler enthalten. ${p.name} gewährleistet nicht, dass sie richtig, vollständig oder aktuell sind; der Gastgeber bleibt für seine Inhalte verantwortlich und weist die Gäste im Chat auf diese Einschränkung hin (der Chat zeigt den Hinweis automatisch an). Gesprächstexte werden nicht gespeichert; es werden nur Anzahl und Umfang der Gespräche gezählt. Der Gastgeber informiert seine Gäste über den Einsatz des Chats in der bereitgestellten Datenschutzerklärung (wird bei eingeschaltetem Modul automatisch ergänzt).`,
      ] },
      { h: "8. Optionales Modul «Upselling»", p: [
        `Der Gastgeber kann das Modul «Upselling» im Admin einschalten. ${p.name} versendet dann im Namen des Gastgebers an Gäste, die dem Erhalt von Angeboten zugestimmt haben, vor der Anreise eine E-Mail mit den vom Gastgeber erfassten Zusatzangeboten. Die Gäste bezahlen diese Angebote über Stripe direkt an den Gastgeber.`,
        `${p.name} erhält für jeden bezahlten Verkauf eine Provision von 5 % des Verkaufsbetrags, die bei der Zahlung automatisch einbehalten wird. Es gibt keine Grundgebühr. Die Provision wird bei der Bestätigung des Gastgebers festgehalten; Änderungen kündigt ${p.name} wie nach Ziffer 2 mit mindestens 60 Tagen Frist an. Wird eine Zahlung vom Gastgeber oder von Stripe zurückerstattet, richtet sich die Rückerstattung der Provision nach den Regeln von Stripe.`,
        `Der Gastgeber ist für Inhalt, Preise, Verfügbarkeit und Erbringung seiner Angebote sowie für die rechtlich korrekte Preisangabe verantwortlich. Er kann das Modul jederzeit ausschalten; bereits bezahlte Bestellungen bleiben bestehen und sind zu erbringen.`,
      ] },
      { h: "9. Schlussbestimmungen", p: [
        `Änderungen dieser Bedingungen werden mindestens 30 Tage im Voraus per E-Mail mitgeteilt. Es gilt Schweizer Recht. Gerichtsstand ist der Sitz von ${p.name}.`,
      ] },
    ],
  };
}
