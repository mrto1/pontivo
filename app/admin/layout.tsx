import type { Metadata } from "next";

// Nur der übergeordnete Plattform-Admin (/admin/plattform) liegt noch unter /admin. Er ist nirgends verlinkt.
// Die Hotel-Oberfläche heisst myPontivo und liegt unter /mypontivo.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="pv-admin">{children}</div>;
}
