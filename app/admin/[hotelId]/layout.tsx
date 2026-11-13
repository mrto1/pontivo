import { requireHotel } from "@/src/auth/guard";
import { adminNav } from "@/src/admin/nav";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionTabs } from "@/components/admin/SectionTabs";

export default async function HotelAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId);
  // Während der Einrichtung: schlanke Navigation
  const setup = !!hotel.onboarding.startedAt && !hotel.onboarding.completedAt;
  const nav = adminNav(hotel, setup);
  const home = `/admin/${hotel.id}`;
  return (
    <>
      <header className="admin-head">
        <div className="wrap">
          <a href="/admin" className="brand admin-brand">{hotel.name}</a>
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
