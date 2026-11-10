import { PlatformLegalPage } from "@/components/marketing/PlatformLegalPage";
import { hostTerms, HOST_TERMS_VERSION } from "@/src/legal/host-terms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bedingungen für Gastgeber – Pontivo" };

export default function HostTerms() {
  const d = hostTerms();
  return <PlatformLegalPage doc={{ ...d, sections: [...d.sections, { h: "Version", p: [HOST_TERMS_VERSION] }] }} />;
}
