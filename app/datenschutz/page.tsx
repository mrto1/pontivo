import { PlatformLegalPage } from "@/components/marketing/PlatformLegalPage";
import { platformPrivacy } from "@/src/legal/platform";

export const dynamic = "force-dynamic";
export const metadata = { title: "Datenschutz – Pontivo" };

export default function Page() {
  return <PlatformLegalPage doc={platformPrivacy()} />;
}
