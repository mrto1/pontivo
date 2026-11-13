/**
 * Plattformgebühr pro Direktbuchung (Application Fee). Standard für neue Hotels; je Hotel in `hotels.platform_fee_bps`.
 * 190 Basispunkte = 1,9 %. Alle Texte (Website, Bedingungen, E-Mails) nehmen den Wert von hier bzw. vom Hotel.
 */
export const DEFAULT_PLATFORM_FEE_BPS = 190;

/** «1.9» (Schweizer Schreibweise, ohne Prozentzeichen) */
export function feePercentText(bps: number = DEFAULT_PLATFORM_FEE_BPS): string {
  return (bps / 100).toLocaleString("de-CH", { maximumFractionDigits: 2 });
}
