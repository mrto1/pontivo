import { requireHotel } from "@/src/auth/guard";
import { hotelsForUser } from "@/src/auth/session";
import { visibleNav } from "@/src/admin/visible-nav";
import { hiddenNavKeys } from "@/src/domain/modules";
import { isLimitedRole, roleLabel } from "@/src/domain/roles";
import { moduleRows } from "@/src/services/modules";
import { AdminNav } from "@/components/admin/AdminNav";
import { AreaProvider } from "@/components/admin/AreaContext";
import { AreaSwitch } from "@/components/admin/AreaSwitch";
import { cookies } from "next/headers";
import { DINING_LABEL, LODGING_LABEL, type Area } from "@/src/admin/nav";
import { onlineReservationsToday } from "@/src/services/reservations";
import { SectionTabs } from "@/components/admin/SectionTabs";
import { BrandMark } from "@/components/admin/BrandMark";
import { SettingsFrame } from "@/components/admin/SettingsFrame";
import { TooltipHost } from "@/components/admin/TooltipHost";
import { SetupNotices } from "@/components/admin/SetupNotices";
import { atLeast } from "@/src/auth/session";
import { onboardingSteps } from "@/src/services/onboarding";
import { initials } from "@/src/domain/avatar";
import { parallelBanner, setupBanner, setupOpen, unmetNeeds } from "@/src/domain/setup";

export default async function HotelAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "layout");
  const cookieName = `pv_area_${user.id.slice(0, 8)}`;
  const saved = (await cookies()).get(cookieName)?.value;
  const vn = visibleNav(hotel, role, hiddenNavKeys(await moduleRows(hotel.id)), saved === "dining" ? "dining" : "lodging");
  const { nav, showSettings } = vn;
  const initialArea: Area = vn.navs.dining && nav === vn.navs.dining ? "dining" : "lodging";
  const diningBadge = vn.showSwitch ? await onlineReservationsToday(hotel) : 0;
  const home = `/mypontivo/${hotel.id}`;
  // Stand der Einrichtung: Chip in der Kopfzeile und Hinweise auf jeder Seite (nur Inhaber und Geschäftsführung)
  const manages = !isLimitedRole(role) && atLeast(role, "manager");
  const steps = manages && setupOpen(hotel) ? await onboardingSteps(hotel) : null;
  const banner = manages ? setupBanner(hotel, steps) : null;
  const parallel = manages ? parallelBanner(hotel) : null;
  const doneCount = steps?.filter((x) => x.done).length ?? 0;
  const others = (await hotelsForUser(user.id)).filter((x) => x.hotel.id !== hotel.id);
  return (
    <AreaProvider navs={vn.navs} initialArea={initialArea} cookieName={cookieName} home={home} marked={vn.showSwitch}>
      <header className="admin-head">
        <div className="wrap">
          <a href="/mypontivo" className="brand admin-brand" title="myPontivo: Betrieb wechseln"><BrandMark /><span className="muted brand-name">{hotel.name}</span></a>
          {others.length > 0 && !user.isPlatformAdmin ? (
            <details className="small" style={{ display: "inline-block", marginLeft: 12 }}>
              <summary>Betrieb wechseln</summary>
              <ul className="stack" style={{ listStyle: "none", padding: 8, margin: 0 }}>
                {others.map((x) => <li key={x.hotel.id}><a href={`/mypontivo/${x.hotel.id}`}>{x.hotel.name}</a></li>)}
                <li><a href="/mypontivo">Übersicht aller Betriebe</a></li>
              </ul>
            </details>
          ) : null}
          {vn.showSwitch ? <AreaSwitch lodgingLabel={LODGING_LABEL[hotel.propertyType] ?? "Hotel"} diningLabel={DINING_LABEL[hotel.diningLabel]?.de ?? "Restaurant"} diningBadge={diningBadge} /> : null}
          {steps ? <a href={`${home}/einrichten`} className="setup-chip" title="Einrichtung fortsetzen">Einrichtung {doneCount} von {steps.length}</a> : null}
          <AdminNav nav={nav} home={home} userLabel={`${user.email} · ${roleLabel(role)}`} initials={initials(user.name, user.email)} showSettings={showSettings} />
        </div>
      </header>
      <TooltipHost />
      <main className="wrap admin-main">
        <SetupNotices home={home} banner={banner} parallel={parallel} unmet={steps ? unmetNeeds(steps) : []} />
        <SettingsFrame nav={nav} home={home} tabs={<SectionTabs nav={nav} home={home} />}>{children}</SettingsFrame>
      </main>
    </AreaProvider>
  );
}
