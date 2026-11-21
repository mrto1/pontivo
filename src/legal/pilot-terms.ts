import { platformInfo, type LegalDoc } from "./texts";
import { feePercentText } from "../domain/fee";
import { formatChf } from "../domain/money";
import { ORDER_INTRO_MONTHS, PILOT_CAP_RAPPEN, PILOT_MONTHS, PILOT_SLOTS } from "../domain/order-fee";
import { ORDER_MODULE_RAPPEN } from "../domain/platform-invoice";

/**
 * Pilotbedingungen Online-Bestellung (SPEC 20.4, Entscheid 21.11.2026): Sonderangebot für alle, Kostendach für die ersten Pilotbetriebe.
 * Ergänzen die Bedingungen für Gastgeber; bestätigt beim ersten Einschalten der Online-Bestellung (online_order_settings.terms_version).
 * WICHTIG: Vor dem produktiven Einsatz juristisch prüfen lassen (QUESTIONS.md).
 */
export const PILOT_TERMS_VERSION = "2026-11-21";
export const INTRO_NOTICE_DAYS = 30;

export function pilotTerms(): LegalDoc {
  const p = platformInfo();
  const fee = feePercentText();
  const flat = formatChf(ORDER_MODULE_RAPPEN);
  const cap = formatChf(PILOT_CAP_RAPPEN);
  return {
    title: `Pilotbedingungen Online-Bestellung – ${p.name}`,
    intro: `Diese Bedingungen gelten für die Online-Bestellung (Abholung und Lieferung) von ${p.name}. Sie ergänzen die Bedingungen für Gastgeber zwischen dem Betrieb und ${p.operator} («${p.name}»). Wo sie davon abweichen, gehen für die Online-Bestellung diese Pilotbedingungen vor; im Übrigen gelten die Bedingungen für Gastgeber.`,
    draftNote: "",
    sections: [
      { h: "1. Normalpreis", p: [
        `Die Online-Bestellung kostet ${fee} % des Bestellbetrags (inklusive Liefergebühr) pro Bestellung, auch bei Barzahlung. Bei Zahlung mit Karte oder TWINT wird die Gebühr bei der Zahlung einbehalten, bei Barzahlung kommt sie auf die Monatsrechnung. Abgelehnte, nicht angenommene und zurückerstattete Bestellungen kosten nichts. Probebestellungen sind kostenlos.`,
        `Die Gebühren werden wie die übrigen Gebühren an die Mindestgebühr nach den Bedingungen für Gastgeber angerechnet.`,
      ] },
      { h: "2. Sonderangebot für den Start", p: [
        `In den ersten ${ORDER_INTRO_MONTHS} Monaten ab dem ersten Einschalten der Online-Bestellung zahlt der Betrieb statt des Normalpreises pauschal ${flat} pro Kalendermonat, unabhängig von der Anzahl Bestellungen. Der angefangene Monat des ersten Einschaltens zählt zusätzlich und ebenfalls pauschal (Beispiel: erstes Einschalten am 10. Januar, Sonderangebot bis 30. April).`,
        `Die Pauschale wird für jeden Monat verrechnet, in dem die Online-Bestellung am Abrechnungstag eingeschaltet ist oder echte Bestellungen hatte. Teilmonate werden nicht anteilig berechnet. Aus- und wieder Einschalten verlängert das Sonderangebot nicht.`,
        `${p.name} weist den Betrieb mindestens ${INTRO_NOTICE_DAYS} Tage vor Ende des Sonderangebots per E-Mail auf den Wechsel zum Normalpreis hin. Danach gilt ohne weitere Erklärung der Normalpreis nach Ziffer 1.`,
        `${p.name} kann die Pauschale über das Ende des Sonderangebots hinaus weiter verrechnen, statt den Normalpreis zu berechnen. Die Einführung des Normalpreises kündigt ${p.name} in diesem Fall mindestens 60 Tage im Voraus per E-Mail an; der Betrieb hat dann das Sonderkündigungsrecht nach den Bedingungen für Gastgeber.`,
      ] },
      { h: "3. Pilotbetriebe", p: [
        `Die ersten ${PILOT_SLOTS} Betriebe, die die Online-Bestellung erstmals einschalten, werden Pilotbetrieb. Massgebend ist die Reihenfolge des ersten Einschaltens. Der Betrieb sieht seinen Status und dessen Dauer in myPontivo bei den Einstellungen der Online-Bestellung.`,
        `Kostendach: Während ${PILOT_MONTHS} Monaten ab dem ersten Einschalten betragen die Gebühren der Online-Bestellung nach Ziffer 1 höchstens ${cap} pro Kalendermonat. Ist das Dach erreicht, sind weitere Bestellungen in diesem Monat gebührenfrei. Die Monate des Sonderangebots zählen zu den ${PILOT_MONTHS} Monaten. Nach Ablauf gilt der Normalpreis ohne Dach.`,
        `Das Kostendach betrifft nur die Gebühren der Online-Bestellung. Mindestgebühr, Kasse, Gutscheine, SMS, KI-Chat und weitere Module werden nach den Bedingungen für Gastgeber berechnet.`,
        `Der Pilotstatus ist an den Betrieb gebunden und nicht übertragbar. Er endet vorzeitig mit dem Ende des Vertrags. ${p.name} kann ihn entziehen, wenn der Betrieb keine echte Online-Bestellung anbietet (z. B. Test- oder Scheinbetrieb) oder die Bedingungen missbräuchlich nutzt.`,
      ] },
      { h: "4. Mitwirkung", p: [
        `${p.name} entwickelt die Online-Bestellung mit den Pilotbetrieben weiter. Der Betrieb kann Rückmeldungen, Fehler und Wünsche jederzeit melden; ${p.name} kann ihn gelegentlich um ein kurzes Gespräch bitten. Eine Pflicht zur Mitwirkung besteht nicht, und der Pilotstatus hängt nicht davon ab.`,
        `${p.name} darf Rückmeldungen und Ideen ohne Vergütung für die Weiterentwicklung verwenden. Den Namen oder das Logo des Betriebs als Referenz verwendet ${p.name} nur mit dessen ausdrücklicher Zustimmung, die er jederzeit widerrufen kann.`,
      ] },
      { h: "5. Funktionen", p: [
        `Die Online-Bestellung wird laufend weiterentwickelt. Einzelne Funktionen können sich ändern oder neu hinzukommen; ein Anspruch auf bestimmte künftige Funktionen besteht nicht. Für Verfügbarkeit und Haftung gelten die Bedingungen für Gastgeber.`,
      ] },
      { h: "6. Preise und Kündigung", p: [
        `Alle Preise verstehen sich ohne Mehrwertsteuer, sofern diese geschuldet ist. Der Betrieb kann die Online-Bestellung jederzeit ausschalten und den Vertrag nach den Bedingungen für Gastgeber kündigen.`,
      ] },
    ],
  };
}
