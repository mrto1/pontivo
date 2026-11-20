/**
 * Gesundheits-Ampel pro Betrieb (SPEC 19.31), reine Logik ohne I/O.
 * Rot = Handeln nötig (Betrieb kann nicht verkaufen oder zahlt nicht), Gelb = nachfassen, Grün = in Ordnung.
 */
export type HealthSignals = {
  status: "draft" | "live" | "paused" | string;
  /** Tage seit Anlage des Betriebs */
  ageDays: number;
  /** Tage seit Live-Schaltung, null wenn nie live */
  liveDays: number | null;
  stripeChargesEnabled: boolean;
  hasCard: boolean;
  failedCharges: number;
  /** bestätigte Direktbuchungen in den letzten 30 Tagen bzw. den 30 Tagen davor */
  bookings30: number;
  bookingsPrev30: number;
  /** Tage, für die noch Preise und Verfügbarkeit hinterlegt sind (ab heute) */
  horizonDays: number;
  /** aktive iCal-Feeds mit Fehler, fehlgeschlagene Channex-Meldungen */
  feedErrors: number;
  channexErrors: number;
  /** Tage seit der letzten Änderung im Admin, null = nie */
  idleDays: number | null;
  onboardingDone: boolean;
};

export type HealthLevel = "red" | "yellow" | "green";
export type Health = { level: HealthLevel; reasons: { level: Exclude<HealthLevel, "green">; text: string }[] };

export function healthOf(s: HealthSignals): Health {
  const reasons: Health["reasons"] = [];
  const red = (text: string) => reasons.push({ level: "red", text });
  const yellow = (text: string) => reasons.push({ level: "yellow", text });

  if (s.status === "live") {
    if (!s.stripeChargesEnabled) red("Stripe-Konto nicht freigeschaltet: Gäste können nicht bezahlen");
    if (s.failedCharges > 0) red(`${s.failedCharges} Abrechnung(en) nicht bezahlt (Karte fehlgeschlagen)`);
    if (s.horizonDays < 14) red(`Preise und Verfügbarkeit nur noch für ${Math.max(0, s.horizonDays)} Tage hinterlegt`);
    if (s.channexErrors > 0) red(`${s.channexErrors} Fehler bei der Channex-Übertragung`);
    if (!s.hasCard) yellow("Keine Karte für die Abrechnung hinterlegt");
    else if (s.horizonDays < 60) yellow(`Preise nur für ${s.horizonDays} Tage hinterlegt`);
    if (s.feedErrors > 0) yellow(`${s.feedErrors} Kalender-Abgleich(e) mit Fehler`);
    if ((s.liveDays ?? 0) >= 45 && s.bookings30 === 0) yellow("Keine Direktbuchung in den letzten 30 Tagen");
    else if (s.bookingsPrev30 >= 4 && s.bookings30 < s.bookingsPrev30 / 2) yellow(`Direktbuchungen halbiert (${s.bookingsPrev30} → ${s.bookings30})`);
    if ((s.idleDays ?? Infinity) > 30) yellow(s.idleDays === null ? "Im Admin noch nichts bearbeitet" : `Seit ${s.idleDays} Tagen nichts im Admin bearbeitet`);
  } else if (s.status === "draft") {
    if (!s.onboardingDone && s.ageDays >= 14) red(`Einrichtung seit ${s.ageDays} Tagen nicht abgeschlossen`);
    else if (!s.onboardingDone && s.ageDays >= 5) yellow(`Einrichtung seit ${s.ageDays} Tagen offen`);
  } else if (s.status === "paused") {
    yellow("Betrieb pausiert");
  }
  const level: HealthLevel = reasons.some((r) => r.level === "red") ? "red" : reasons.length ? "yellow" : "green";
  return { level, reasons };
}

export const HEALTH_LABEL: Record<HealthLevel, string> = { red: "Handeln", yellow: "Nachfassen", green: "In Ordnung" };
