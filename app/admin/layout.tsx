import type { Metadata } from "next";

// /admin ist die Plattform-Verwaltung (nur Plattform-Admins, Einstieg: /admin).
// Die Hotel-Oberfläche heisst myPontivo und liegt unter /mypontivo.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pv-admin">
      <header className="admin-head">
        <div className="wrap">
          <a href="/admin/plattform" className="brand admin-brand">myPontivo<span className="muted" style={{ fontWeight: 400 }}> · Plattform</span></a>
          <nav className="admin-nav" aria-label="Plattform">
            <a href="/admin/plattform">Verwaltung</a>
            <a href="/admin/plattform/website">Website-Texte</a>
          </nav>
          <a href="/mypontivo" className="small" style={{ marginLeft: "auto" }}>Zu meinen Betrieben</a>
        </div>
      </header>
      {children}
    </div>
  );
}
