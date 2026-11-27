/**
 * Umschalt-Checkliste (PMS-ERSATZ 2.6): vom Parallelbetrieb zum alleinigen Betrieb mit Pontivo. Reine Logik ohne I/O.
 * Manche Punkte prüft Pontivo selbst, andere bestätigt der Gastgeber. Nichts wird gesperrt: «Umschalten» ist eine bewusste Bestätigung.
 */
export type SwitchState = { confirmed?: string[]; oldFuture?: number; switchedAt?: string };
export type SwitchFacts = {
  roomTypes: number; ratePlansComplete: boolean; futureBookings: number; importedFuture: number; channexEnabled: boolean;
  stripeCharges: boolean; invoiceLast: number; members: number;
};
export type SwitchItem = { key: string; title: string; help: string; hint: string; done: boolean; required: boolean; confirmable: boolean };

export const SWITCH_KEYS = ["stammdaten", "reservierungen", "kanaele", "zahlungen", "rechnungsnummer", "team", "altzugang"] as const;

export function evaluateSwitchover(f: SwitchFacts, st: SwitchState): { items: SwitchItem[]; ready: boolean; diff: number | null } {
  const ok = (k: string) => (st.confirmed ?? []).includes(k);
  const diff = st.oldFuture === undefined ? null : f.futureBookings - st.oldFuture;
  const items: SwitchItem[] = [
    { key: "stammdaten", title: "Zimmer, Preise und Tarife stimmen", help: "Vergleichen Sie ein paar Daten in Kalender und Preisen mit Ihrer bisherigen Software.",
      hint: f.roomTypes === 0 ? "Noch keine Zimmer erfasst." : f.ratePlansComplete ? `${f.roomTypes} Zimmertypen mit Tarif erfasst.` : "Nicht jeder Zimmertyp hat einen Tarif.", done: f.roomTypes > 0 && f.ratePlansComplete && ok("stammdaten"), required: true, confirmable: f.roomTypes > 0 && f.ratePlansComplete },
    { key: "reservierungen", title: "Künftige Reservationen sind vollständig", help: "Tragen Sie unten ein, wie viele künftige Reservationen Ihre bisherige Software zeigt. Pontivo vergleicht.",
      hint: diff === null ? `In Pontivo: ${f.futureBookings} künftige Reservationen (${f.importedFuture} davon übernommen). Zahl aus der alten Software fehlt noch.` : diff === 0 ? `Stimmt: ${f.futureBookings} in Pontivo, ${st.oldFuture} in der alten Software.` : `Abweichung: ${f.futureBookings} in Pontivo, ${st.oldFuture} in der alten Software (${diff > 0 ? "+" : ""}${diff}). Klären Sie die Differenz oder bestätigen Sie sie bewusst.`,
      done: diff === 0 || (diff !== null && ok("reservierungen")), required: true, confirmable: diff !== null && diff !== 0 },
    { key: "kanaele", title: "Kanäle laufen über Pontivo, der alte Zugang ist getrennt", help: "Ein Kanal darf nie von zwei Systemen gleichzeitig gesteuert werden: erst in Pontivo verbinden und Verfügbarkeit prüfen, dann im alten System den Kanal trennen. Bis dahin hilft der Kalender-Abgleich (iCal). Wenn Sie keine Portale nutzen, bestätigen Sie das.",
      hint: f.channexEnabled ? "Channel-Manager ist in Pontivo verbunden." : "Der Channel-Manager ist in Pontivo nicht verbunden.", done: ok("kanaele"), required: true, confirmable: true },
    { key: "zahlungen", title: "Zahlungskonto aktiv, Testzahlung gemacht", help: "Machen Sie eine Testbuchung mit Ihrer eigenen Karte und stornieren Sie sie danach.",
      hint: f.stripeCharges ? "Stripe kann Zahlungen empfangen." : "Stripe ist noch nicht freigeschaltet (Einrichtung, Schritt «Zahlungen empfangen»).", done: f.stripeCharges && ok("zahlungen"), required: true, confirmable: f.stripeCharges },
    { key: "rechnungsnummer", title: "Rechnungsnummern laufen lückenlos weiter", help: "Setzen Sie die nächste Nummer Ihrer bisherigen Reihe. Wenn Sie keine Reihe weiterführen, bestätigen Sie das.",
      hint: f.invoiceLast > 0 ? `Zähler steht auf ${f.invoiceLast}.` : "Noch keine Nummer gesetzt.", done: f.invoiceLast > 0 || ok("rechnungsnummer"), required: true, confirmable: f.invoiceLast === 0 },
    { key: "team", title: "Team eingeladen, Rollen gesetzt, 2FA empfohlen", help: "Unter «Einstellungen» laden Sie Mitarbeitende ein und vergeben Rollen (Rezeption, Reinigung, Buchhaltung, Service).",
      hint: `${f.members} ${f.members === 1 ? "Person hat" : "Personen haben"} Zugang.`, done: ok("team"), required: true, confirmable: true },
    { key: "altzugang", title: "Alter Zugang: Kündigungsfrist und Datenexport erledigt", help: "Nur ein Hinweis: Prüfen Sie Kündigungsfrist und Export bei Ihrem bisherigen Anbieter. Bewahren Sie Rechnungen 10 Jahre auf.",
      hint: "Freiwillig.", done: ok("altzugang"), required: false, confirmable: true },
  ];
  return { items, ready: items.filter((i) => i.required).every((i) => i.done), diff };
}

/** Rückweg: 30 Tage nach dem Umschalten kann der Import noch rückgängig gemacht werden */
export const ROLLBACK_DAYS = 30;
export const rollbackUntil = (switchedAt: string) => new Date(new Date(switchedAt).getTime() + ROLLBACK_DAYS * 86_400_000);
