import { requireHotel } from "@/src/auth/guard";
import { hotelsForUser } from "@/src/auth/session";
import { adminNav } from "@/src/admin/nav";
import { hiddenNavKeys } from "@/src/domain/modules";
import { moduleRows } from "@/src/services/modules";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionTabs } from "@/components/admin/SectionTabs";

export default async function HotelAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId);
  // Während der Einrichtung: schlanke Navigation
  const setup = !!hotel.onboarding.startedAt && !hotel.onboarding.completedAt;
  const nav = adminNav(hotel, setup, hiddenNavKeys(await moduleRows(hotel.id)));
  const home = `/admin/${hotel.id}`;
  const others = (await hotelsForUser(user.id)).filter((x) => x.hotel.id !== hotel.id);
  return (
    <>
      <header className="admin-head">
        <div className="wrap">
          <a href="/admin" className="brand admin-brand">{hotel.name}</a>
          {others.length > 0 && !user.isPlatformAdmin ? (
            <details className="small" style={{ display: "inline-block", marginLeft: 12 }}>
              <summary>Betrieb wechseln</summary>
              <ul className="stack" style={{ listStyle: "none", padding: 8, margin: 0 }}>
                {others.map((x) => <li key={x.hotel.id}><a href={`/admin/${x.hotel.id}`}>{x.hotel.name}</a></li>)}
                <li><a href="/admin">Übersicht aller Betriebe</a></li>
              </ul>
            </details>
          ) : null}
          <AdminNav nav={nav} home={home} hotelId={hotel.id} userLabel={`${user.email} · ${role}`} />
        </div>
      </header>
      <main className="wrap admin-main">
        <SectionTabs nav={nav} home={home} />
        {children}
      </main>
    </>
  );
}
