import { headers } from "next/headers";

import { TEST_NOW_HEADER } from "./clock-header";

/** Darf ein Test die Uhrzeit vorgeben? Nie im Produktionsbetrieb. */
export const testClockAllowed = () => process.env.E2E_CLOCK === "1" && process.env.NODE_ENV !== "production";

/**
 * Jetzt, für Seiten und Server Actions mit Tageszeit-Logik (Abholzeiten, Öffnungszeiten).
 * End-to-End-Tests geben die Zeit per Kopfzeile vor, damit sie nicht von der echten Uhrzeit abhängen (z. B. kurz vor Mitternacht).
 */
export async function requestNow(): Promise<Date> {
  if (testClockAllowed()) {
    const v = (await headers()).get(TEST_NOW_HEADER);
    if (v && !Number.isNaN(Date.parse(v))) return new Date(v);
  }
  return new Date();
}
