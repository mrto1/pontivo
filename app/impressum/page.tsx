import { PlatformLegalPage } from "@/components/marketing/PlatformLegalPage";
import { platformImprint } from "@/src/legal/platform";

export const dynamic = "force-dynamic";
// Gesetzlich nötig, aber nicht in Suchmaschinen: Adresse nur für Besucher der Seite
export const metadata = { title: "Impressum – Pontivo", robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true, "max-snippet": 0 } } };

export default function Page() {
  return <PlatformLegalPage doc={platformImprint()} />;
}
