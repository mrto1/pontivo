import { PlatformLegalPage } from "@/components/marketing/PlatformLegalPage";
import { pilotTerms, PILOT_TERMS_VERSION } from "@/src/legal/pilot-terms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pilotbedingungen Online-Bestellung – Pontivo" };

/** Pilotbedingungen Online-Bestellung (SPEC 20.4): Sonderangebot und Pilotbetriebe */
export default function PilotTerms() {
  const d = pilotTerms();
  return <PlatformLegalPage doc={{ ...d, sections: [...d.sections, { h: "Version", p: [PILOT_TERMS_VERSION] }] }} />;
}
