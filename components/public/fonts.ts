import { Cormorant_Garamond, Fraunces, Inter, Lato, Manrope, Nunito, Playfair_Display, Source_Sans_3, Work_Sans, Zilla_Slab } from "next/font/google";
import type { FontKey } from "@/src/domain/theme";

/**
 * Schriften der Hotel-Websites, selbst gehostet über next/font (keine Anfrage an Google beim Gast).
 * preload: false – der Browser lädt nur die Schriften, die eine Seite tatsächlich verwendet.
 */
const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["600", "700"] });
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "600", "700"] });
const cormorant = Cormorant_Garamond({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["500", "600", "700"] });
const lato = Lato({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "700"] });
const playfair = Playfair_Display({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["600", "700"] });
const sourceSans = Source_Sans_3({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "600", "700"] });
const manrope = Manrope({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "600", "700", "800"] });
const zilla = Zilla_Slab({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["500", "600", "700"] });
const workSans = Work_Sans({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "600", "700"] });
const nunito = Nunito({ subsets: ["latin", "latin-ext"], display: "swap", preload: false, weight: ["400", "600", "700", "800"] });

type Face = { style: { fontFamily: string } };
const PAIRS: Record<FontKey, { head: Face; body: Face }> = {
  klassisch: { head: fraunces, body: inter },
  elegant: { head: cormorant, body: lato },
  zeitlos: { head: playfair, body: sourceSans },
  modern: { head: manrope, body: manrope },
  landhaus: { head: zilla, body: workSans },
  freundlich: { head: nunito, body: nunito },
};

/** CSS-Variablen für Titel- und Textschrift */
export function fontVars(key: FontKey): Record<string, string> {
  const p = PAIRS[key];
  return { "--serif": p.head.style.fontFamily, "--font": p.body.style.fontFamily };
}
