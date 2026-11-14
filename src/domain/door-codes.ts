import { zonedToUtc, type Day } from "./dates";

/**
 * Keypad-Codes für Gäste (SPEC 18.5), reine Logik.
 * ASSUMPTION: Nuki verlangt 6-stellige Codes ohne 0 und nicht beginnend mit «12» (aus der Nuki-Hilfe, in der Swagger-Datei nicht enthalten).
 */
export function generateCode(rand: (n: number) => number = (n) => Math.floor(Math.random() * n)): number {
  for (;;) {
    let s = "";
    for (let i = 0; i < 6; i++) s += String(1 + rand(9));
    if (!s.startsWith("12")) return Number(s);
  }
}

export const validCode = (c: number) => Number.isInteger(c) && /^[1-9]{6}$/.test(String(c)) && !String(c).startsWith("12");

/** Gültigkeit: ab Check-in-Zeit bis Check-out-Zeit des Betriebs (Ortszeit) */
// ASSUMPTION: keine Pufferzeit; früherer Zutritt braucht einen neuen Code oder manuelle Anpassung.
export function codeWindow(checkin: Day, checkout: Day, checkinTime: string, checkoutTime: string, tz: string): { from: Date; until: Date } {
  return { from: zonedToUtc(checkin, checkinTime.slice(0, 5), tz), until: zonedToUtc(checkout, checkoutTime.slice(0, 5), tz) };
}

/** Name der Berechtigung bei Nuki (höchstens 32 Zeichen) */
export const authName = (reference: string) => `Pontivo ${reference}`.slice(0, 32);
