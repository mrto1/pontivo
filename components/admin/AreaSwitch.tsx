"use client";
import { useArea } from "./AreaContext";
import type { Area } from "@/src/admin/nav";

const BED = "M3 18V7 M3 14h18v4 M21 14v-2a3 3 0 00-3-3h-7v5 M7 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z";
const CUTLERY = "M7 3v8 M5 3v5a2 2 0 004 0V3 M7 11v10 M17 3c-2 2-2 6 0 8v10 M17 3v18";

/**
 * Umschalter Unterkunft | Gastronomie (SPEC 20.1): in der Kopfzeile direkt nach dem Betriebsnamen, nur Symbole Bett und Besteck
 * (Desktop und Handy gleich). Die Bezeichnung im Vokabular des Betriebs (z. B. «Hotel», «Restaurant») steht als Tooltip und Screenreader-Name.
 * ASSUMPTION: Kein Badge, bis definiert ist, was die Zahl aussagen soll.
 */
export function AreaSwitch({ lodgingLabel, diningLabel }: { lodgingLabel: string; diningLabel: string }) {
  const ctx = useArea();
  if (!ctx || !ctx.navs.lodging || !ctx.navs.dining) return null;
  const go = (a: Area) => {
    if (a === ctx.area) return;
    ctx.choose(a);
    window.location.href = ctx.navs[a]!.primary[0]?.href ?? window.location.href;
  };
  const part = (a: Area, label: string, icon: string) => (
    <button type="button" className={`area-part${ctx.area === a ? " on" : ""}`} aria-pressed={ctx.area === a} aria-label={label} onClick={() => go(a)} title={`Bereich ${a === "lodging" ? "Unterkunft" : "Gastronomie"}: ${label}`}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
    </button>
  );
  return (
    <div className="area-switch" role="group" aria-label="Bereich wählen">
      {part("lodging", lodgingLabel, BED)}
      {part("dining", diningLabel, CUTLERY)}
    </div>
  );
}
