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
      <div className="settings-grid">
        {groups.map((g) => (
          <section key={g.title} className="card">
            <h2 style={{ margin: 0 }}>{g.title}</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>{g.lead}</p>
            <ul>
              {g.items.map((i) => (
                <li key={i.key}><a href={i.href}><strong>{i.label}</strong>{i.lead ? <span className="muted small" style={{ display: "block" }}>{i.lead}</span> : null}</a></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
