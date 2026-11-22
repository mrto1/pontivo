import { BrandMark } from "@/components/admin/BrandMark";
import type { Metadata } from "next";
import { currentUserId } from "@/src/auth/guard";
import { getUser } from "@/src/auth/session";
import { platformNav, PLATFORM_HOME } from "@/src/admin/platform-nav";
import { initials } from "@/src/domain/avatar";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionTabs } from "@/components/admin/SectionTabs";

// /plattform ist die Plattform-Verwaltung (nur Plattform-Admins, Einstieg: /plattform).
// Die Oberfläche der Betriebe liegt unter /admin.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const id = await currentUserId();
  const user = id ? await getUser(id) : null;
  const nav = platformNav();
  return (
    <div className="pv-admin">
      <header className="admin-head">
        <div className="wrap">
          <a href={PLATFORM_HOME} className="brand admin-brand" title="Pontivo"><BrandMark /><span className="muted brand-name">Plattform</span></a>
          {user?.isPlatformAdmin ? <AdminNav nav={nav} home={PLATFORM_HOME} userLabel={`${user.email} · Zu meinen Betrieben`} initials={initials(user.name, user.email)} showSettings={false} /> : null}
        </div>
      </header>
      <main className="wrap admin-main">
        {user?.isPlatformAdmin ? <SectionTabs nav={nav} home={PLATFORM_HOME} /> : null}
        {children}
      </main>
    </div>
  );
}
