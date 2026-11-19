/** Farben für das Erscheinungsbild eines Hotels (reine Logik) */

export const HEX = /^#[0-9a-f]{6}$/i;

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Schriftfarbe auf der Markenfarbe: weiss oder fast schwarz, je nachdem was besser lesbar ist */
export function inkOn(hex: string): string {
  return contrast(hex, "#ffffff") >= contrast(hex, "#1f2a2e") ? "#ffffff" : "#1f2a2e";
}

/**
 * Markenfarbe für Links/Schrift auf hellem Grund: zu helle Farben werden abgedunkelt,
 * bis sie mindestens 4.5:1 Kontrast auf Weiss haben (WCAG AA).
 */
/**
 * Markenfarbe für Links, Knöpfe und Schrift im Nachtmodus: zu dunkle Farben werden aufgehellt,
 * bis sie mindestens 4.5:1 Kontrast auf dem dunklen Grund (#14161a) haben.
 */
export function readableOnDark(hex: string): string {
  let n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const toHex = () => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  for (let i = 0; i < 40 && contrast(toHex(), "#14161a") < 4.5; i++) {
    r = Math.min(255, Math.ceil(r + (255 - r) * 0.12)); g = Math.min(255, Math.ceil(g + (255 - g) * 0.12)); b = Math.min(255, Math.ceil(b + (255 - b) * 0.12));
  }
  return toHex();
}

export function readableOnWhite(hex: string): string {
  let n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < 40 && contrast(`#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`, "#ffffff") < 4.5; i++) {
    r = Math.floor(r * 0.9); g = Math.floor(g * 0.9); b = Math.floor(b * 0.9);
  }
  n = (r << 16) | (g << 8) | b;
  return `#${n.toString(16).padStart(6, "0")}`;
}
