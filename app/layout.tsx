import type { Metadata } from "next";
import "./globals.css";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: "Direktbuchung", robots: { index: !env().ENVIRONMENT_LABEL } };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: Browser-Erweiterungen (z. B. Dark Reader) ändern Attribute an <html>/<body>
    <html lang="de" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        {env().ENVIRONMENT_LABEL ? <div className="env-badge" role="status">Testumgebung ({env().ENVIRONMENT_LABEL}): Daten sind nicht echt</div> : null}
      </body>
    </html>
  );
}
