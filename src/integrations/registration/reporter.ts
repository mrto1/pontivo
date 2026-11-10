import type { Hotel } from "../../db/schema";

/**
 * Meldung der Gästedaten an Behörden oder Tourismusorganisation (SPEC 14).
 * Heute: NoopReporter (Register wird nur geführt und auf Verlangen exportiert).
 * Später: AvsReporter (Meldeschein/Kurtaxe/HESTA über AVS, Spezifikation offen → QUESTIONS.md) und EasyGovReporter
 * (elektronische Meldung ausländischer Gäste nach Art. 16 AIG, Vernehmlassung bis 27.11.2026).
 */
export interface RegistrationReporter {
  readonly name: string;
  /** Meldet die Registrierungen einer Buchung. Darf nicht werfen, wenn nichts zu melden ist. */
  report(bookingId: string): Promise<void>;
}

export class NoopReporter implements RegistrationReporter {
  readonly name = "none";
  async report(): Promise<void> {}
}

// ASSUMPTION: Bis die AVS-Schnittstelle und EasyGov spezifiziert sind, melden alle Hotels über NoopReporter.
export function registrationReporter(_hotel: Hotel): RegistrationReporter {
  return new NoopReporter();
}
