import { requireHotel } from "@/src/auth/guard";
import { settingsGroups } from "@/src/admin/nav";
import { visibleNav } from "@/src/admin/visible-nav";
import { hiddenNavKeys } from "@/src/domain/modules";
import { moduleRows } from "@/src/services/modules";

export const dynamic = "force-dynamic";

/** Zahnrad: Übersicht aller Einstellungen des Betriebs in drei Gruppen (nur Inhaber und Manager). Ausgeschaltete Module fehlen auch hier. */
export default async function Einstellungen({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "manager");
  const groups = settingsGroups(visibleNav(hotel, role, hiddenNavKeys(await moduleRows(hotel.id))).nav);
  return (
    <div className="stack">
      <h1>Einstellungen</h1>
      <p className="muted">Alles zum Einrichten Ihres Betriebs. Was Sie täglich brauchen, finden Sie oben im Menü.</p>
      <div className="set-list">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2 className="set-title">{g.title}</h2>
            <ul className="set-rows">
              {g.items.map((i) => (
                <li key={i.key}>
                  <a href={i.href}>
                    <span className="set-text"><strong>{i.label}</strong>{i.lead ? <span className="muted small">{i.lead}</span> : null}</span>
                    <span className="set-chev" aria-hidden="true">›</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
