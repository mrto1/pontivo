import { requireHotel } from "@/src/auth/guard";
import { hotelsForUser } from "@/src/auth/session";
import { adminNav } from "@/src/admin/nav";
import { hiddenNavKeys } from "@/src/domain/modules";
import { isLimitedRole, ROLE_AREAS, ROLE_LABEL } from "@/src/domain/roles";
import { moduleRows } from "@/src/services/modules";
import { AdminNav } from "@/components/admin/AdminNav";
import { PasskeyNudge } from "@/components/admin/PasskeyNudge";
import { listPasskeys } from "@/src/services/mfa";
import { SectionTabs } from "@/components/admin/SectionTabs";
import { SetupNotices } from "@/components/admin/SetupNotices";
import { atLeast } from "@/src/auth/session";
import { onboardingSteps } from "@/src/services/onboarding";
import { initials } from "@/src/domain/avatar";
import { parallelBanner, setupBanner, setupOpen, unmetNeeds } from "@/src/domain/setup";

export default async function HotelAdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "layout");
  const hidden = hiddenNavKeys(await moduleRows(hotel.id));
  if (isLimitedRole(role)) {
    // eingeschränkte Rollen: alles ausblenden, was nicht zu ihren Bereichen gehört
    const keys = (items: { key: string; tabs?: unknown[] }[]): string[] => items.flatMap((i) => [i.key, ...keys((i.tabs ?? []) as { key: string }[])]);
    const full = adminNav(hotel);
    for (const k of [...keys(full.primary), ...full.groups.flatMap((g) => keys(g.items))]) if (!ROLE_AREAS[role].includes(k)) hidden.add(k);
  }
  const nav = adminNav(hotel, hidden);
  const home = `/admin/${hotel.id}`;
  // Stand der Einrichtung: Chip in der Kopfzeile und Hinweise auf jeder Seite (nur Inhaber und Geschäftsführung)
  const manages = !isLimitedRole(role) && atLeast(role, "manager");
  const steps = manages && setupOpen(hotel) ? await onboardingSteps(hotel) : null;
  const banner = manages ? setupBanner(hotel, steps) : null;
  const parallel = manages ? parallelBanner(hotel) : null;
  const doneCount = steps?.filter((x) => x.done).length ?? 0;
  const noPasskey = (await listPasskeys(user.id)).length === 0;
  const others = (await hotelsForUser(user.id)).filter((x) => x.hotel.id !== hotel.id);
  return (
    <>
      <header className="admin-head">
        <div className="wrap">
          <a href="/admin" className="brand admin-brand">myPontivo<span className="muted" style={{ fontWeight: 400 }}> · {hotel.name}</span></a>
          {others.length > 0 && !user.isPlatformAdmin ? (
            <details className="small" style={{ display: "inline-block", marginLeft: 12 }}>
              <summary>Betrieb wechseln</summary>
              <ul className="stack" style={{ listStyle: "none", padding: 8, margin: 0 }}>
                {others.map((x) => <li key={x.hotel.id}><a href={`/admin/${x.hotel.id}`}>{x.hotel.name}</a></li>)}
                <li><a href="/admin">Übersicht aller Betriebe</a></li>
              </ul>
            </details>
          ) : null}
          {steps ? <a href={`${home}/einrichten`} className="setup-chip" title="Einrichtung fortsetzen">Einrichtung {doneCount} von {steps.length}</a> : null}
          <AdminNav nav={nav} home={home} userLabel={`${user.email} · ${ROLE_LABEL[role]}`} initials={initials(user.name, user.email)} />
        </div>
      </header>
      <main className="wrap admin-main">
        {noPasskey ? <PasskeyNudge /> : null}
        <SetupNotices home={home} banner={banner} parallel={parallel} unmet={steps ? unmetNeeds(steps) : []} />
        <SectionTabs nav={nav} home={home} />
        {children}
      </main>
    </>
  );
}
