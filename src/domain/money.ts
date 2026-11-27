import { UserError } from "./errors";
/** Geld immer als Integer in Rappen (SPEC 0.4). */

/** round_half_up(a * bps / 10000) mit reiner Ganzzahl-Arithmetik (a, bps >= 0) */
export function bpsOf(amountRappen: number, bps: number): number {
  assertInt(amountRappen, "amount");
  assertInt(bps, "bps");
  if (amountRappen < 0 || bps < 0) throw new Error("negative Beträge nicht erlaubt");
  return Math.floor((amountRappen * bps + 5000) / 10000);
}

export function assertInt(n: number, name = "value"): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${name} muss eine ganze Zahl sein (Rappen): ${n}`);
}

/** 18000 → "180.00" (Channex, Anzeige ohne Währung) */
export function rappenToDecimal(r: number): string {
  assertInt(r);
  const sign = r < 0 ? "-" : "";
  const a = Math.abs(r);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** "180.00" → 18000 (ohne Float-Rundungsfehler) */
export function decimalToRappen(s: string | number): number {
  const str = String(s).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(str);
  if (!m) throw new UserError(`ungültiger Betrag: ${s}`);
  const frac = (m[3] ?? "0").padEnd(2, "0");
  const v = Number(m[2]) * 100 + Number(frac);
  return m[1] ? -v : v;
}

/** 37200 → "CHF 372.00" (Schweizer Schreibweise mit Apostroph) */
export function formatChf(r: number): string {
  const [int, frac] = rappenToDecimal(r).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `CHF ${grouped}.${frac}`;
}
