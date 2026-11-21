/**
 * Stand der Einrichtung im Admin (Konzept «volles Menü ab dem ersten Login»): das Menü ist immer gleich, die Seiten zeigen den Stand.
 * Reine Logik ohne I/O.
 */
export type SetupHotel = { status: string; onboarding: { startedAt?: string; completedAt?: string } };
export type SetupStep = { key: string; done: boolean; required: boolean };

export const setupOpen = (h: SetupHotel) => !!h.onboarding.startedAt && !h.onboarding.completedAt;

export type Banner = { kind: "open" | "almost" | "paused" | "parallel"; text: string; cta: string; path: string; done: number; total: number };

/** Hinweiszeile auf jeder Seite (nur für Inhaber und Manager): offen, fast fertig oder pausiert; sonst nichts */
export function setupBanner(h: SetupHotel, steps: SetupStep[] | null): Banner | null {
  if (setupOpen(h) && steps) {
    const done = steps.filter((s) => s.done).length;
    const open = steps.some((s) => s.required && !s.done && s.key !== "live");
    return open
      ? { kind: "open", done, total: steps.length, cta: "Einrichtung fortsetzen", path: "einrichten", text: `Die Einrichtung ist noch nicht abgeschlossen (${done} von ${steps.length} Schritten). Kalender und Zahlen sind erst danach aussagekräftig.` }
      : { kind: "almost", done, total: steps.length, cta: "Online gehen", path: "einrichten?step=live", text: "Fast geschafft: Ihr Betrieb ist startklar, nur «Online gehen» fehlt." };
  }
  if (h.status === "paused" && h.onboarding.completedAt) return { kind: "paused", done: 0, total: 0, cta: "Wieder online schalten", path: "settings", text: "Ihr Betrieb ist pausiert. Gäste können nicht buchen." };
  return null;
}

/** Was eine Seite braucht, damit ihr Inhalt Sinn ergibt: Schritt des Assistenten und Hinweistext */
export const NEEDS = {
  rooms: { step: "unterkunft", text: "Dafür brauchen wir zuerst Ihre Zimmer (oder Ihre Wohnung) mit Preisen." },
  business: { step: "betrieb", text: "Dafür brauchen wir zuerst die Angaben zu Ihrem Betrieb." },
} as const;
export type Need = keyof typeof NEEDS;

/** Menüpunkt (Seitenschlüssel in der Adresse) → was er braucht */
export const PAGE_NEEDS: Record<string, Need> = {
  calendar: "rooms", preise: "rooms", plan: "rooms", housekeeping: "rooms", statistics: "rooms", hesta: "rooms", channex: "rooms", ical: "rooms",
  invoices: "business",
};

/** Noch nicht erfüllte Voraussetzungen (nur solange die Einrichtung läuft) */
export function unmetNeeds(steps: SetupStep[]): Need[] {
  return (Object.keys(NEEDS) as Need[]).filter((n) => !steps.find((s) => s.key === NEEDS[n].step)?.done);
}

/** Parallelbetrieb: bisherige Software läuft noch (Antwort «ja» im Assistenten oder Import), bis das Umschalten bestätigt ist */
export type ParallelHotel = { onboarding: { previousSoftware?: "none" | "yes"; switchover?: { switchedAt?: string } } };
export function parallelBanner(h: ParallelHotel): Banner | null {
  if (h.onboarding.previousSoftware !== "yes" || h.onboarding.switchover?.switchedAt) return null;
  return { kind: "parallel", done: 0, total: 0, cta: "Umschalt-Checkliste", path: "migration/umschalten",
    text: "Parallelbetrieb: Ihre bisherige Software läuft noch. Ändern Sie Buchungen, Preise und Verfügbarkeit nicht an zwei Orten gleichzeitig. Kanäle dürfen nur von einem System gesteuert werden." };
}
