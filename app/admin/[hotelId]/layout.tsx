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
import { SectionTabs } from "@/components/admin/SectionTabs";
import { BrandMark } from "@/components/admin/BrandMark";
import { SettingsFrame } from "@/components/admin/SettingsFrame";
import { TooltipHost } from "@/components/admin/TooltipHost";
import { SetupNotices } from "@/components/admin/SetupNotices";
import { atLeast } from "@/src/auth/session";
import { diningChecklist, isRestaurant, onboardingSteps } from "@/src/services/onboarding";
import { initials } from "@/src/domain/avatar";
import { badgesFor, itemKeyFor, itemKeyForPage, SEEN_KINDS, TASK_KINDS, type TaskKind } from "@/src/domain/unseen";
import { openTaskCounts, SEEN_KIND_LIST, unseenCounts } from "@/src/services/unseen";
import { parallelBanner, setupBanner, setupOpen, unmetNeeds } from "@/src/domain/setup";
import { SetupChip, type Progress } from "@/components/admin/SetupChip";

export default async function HotelAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "layout");
  const cookieName = `pv_area_${user.id.slice(0, 8)}`;
  const saved = (await cookies()).get(cookieName)?.value;
  const vn = visibleNav(hotel, role, hiddenNavKeys(await moduleRows(hotel.id)), saved === "dining" ? "dining" : "lodging");
  const { nav, showSettings } = vn;
  const initialArea: Area = vn.navs.dining && nav === vn.navs.dining ? "dining" : "lodging";
  const home = `/admin/${hotel.id}`;
  // Stand der Einrichtung: Chip in der Kopfzeile und Hinweise auf jeder Seite (nur Inhaber und Geschäftsführung)
  const manages = !isLimitedRole(role) && atLeast(role, "manager");
  const steps = manages && setupOpen(hotel) ? await onboardingSteps(hotel) : null;
  const banner = manages ? setupBanner(hotel, steps) : null;
  const parallel = manages ? parallelBanner(hotel) : null;
  const doneCount = steps?.filter((x) => x.done).length ?? 0;
  // Hotel mit Restaurant: im Bereich Gastronomie zählt die Checkliste «Bereit für den Betrieb», nicht der Assistent der Unterkunft
  const mixed = vn.showSwitch && !isRestaurant(hotel.propertyType);
  const diningList = mixed && manages ? (await diningChecklist(hotel)).filter((c) => c.key !== "domain" && c.key !== "bestellung") : null;
  const lodgingProgress: Progress | null = steps ? { done: doneCount, total: steps.length, href: `${home}/einrichten`, title: "Einrichtung fortsetzen" } : null;
  const diningProgress: Progress | null = diningList && diningList.some((c) => !c.done) ? { done: diningList.filter((c) => c.done).length, total: diningList.length, href: `${home}/restaurant/heute`, title: "Bereit für den Betrieb" } : null;
  // Zahlen für Ungesehenes (nur Listen, die im Menü dieser Person stehen)
  const shown = SEEN_KIND_LIST.filter((k) => itemKeyFor(k, vn.navs[SEEN_KINDS[k].area]) !== null);
  const tasks = (Object.keys(TASK_KINDS) as TaskKind[]).filter((k) => itemKeyForPage(TASK_KINDS[k].page, vn.navs[TASK_KINDS[k].area]) !== null);
  const badges = badgesFor(await unseenCounts(user.id, hotel.id, shown), await openTaskCounts(hotel, tasks), vn.navs);
  const others = (await hotelsForUser(user.id)).filter((x) => x.hotel.id !== hotel.id);
  return (
    <AreaProvider navs={vn.navs} initialArea={initialArea} cookieName={cookieName} home={home} marked={vn.showSwitch}>
      <header className="admin-head">
        <div className="wrap">
          <a href="/admin" className="brand admin-brand" title="Pontivo: Betrieb wechseln"><BrandMark /><span className="muted brand-name">{hotel.name}</span></a>
          {others.length > 0 && !user.isPlatformAdmin ? (
            <details className="small" style={{ display: "inline-block", marginLeft: 12 }}>
              <summary>Betrieb wechseln</summary>
              <ul className="stack" style={{ listStyle: "none", padding: 8, margin: 0 }}>
                {others.map((x) => <li key={x.hotel.id}><a href={`/admin/${x.hotel.id}`}>{x.hotel.name}</a></li>)}
                <li><a href="/admin">Übersicht aller Betriebe</a></li>
              </ul>
            </details>
          ) : null}
          {vn.showSwitch ? <AreaSwitch lodgingLabel={LODGING_LABEL[hotel.propertyType] ?? "Hotel"} diningLabel={DINING_LABEL[hotel.diningLabel]?.de ?? "Restaurant"} badges={badges.byArea} /> : null}
          <SetupChip split={mixed} lodging={lodgingProgress} dining={diningProgress} />
          <AdminNav nav={nav} home={home} userLabel={`${user.email} · ${roleLabel(role)}`} initials={initials(user.name, user.email)} showSettings={showSettings} badges={badges.byItem} />
        </div>
      </header>
      <TooltipHost />
      <main className="wrap admin-main">
        <SetupNotices lodgingOnly={mixed} home={home} banner={banner} parallel={parallel} unmet={steps ? unmetNeeds(steps) : []} />
        <SettingsFrame nav={nav} home={home} tabs={<SectionTabs nav={nav} home={home} />}>{children}</SettingsFrame>
      </main>
    </AreaProvider>
  );
}
