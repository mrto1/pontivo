import { requireHotel } from "@/src/auth/guard";
import { adminNav, allPages } from "@/src/admin/nav";
import { HELP_START } from "@/src/domain/guide";
import { hiddenNavKeys, isOn, MODULES } from "@/src/domain/modules";
import { moduleRows } from "@/src/services/modules";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** Hilfe: je eingeschaltete Funktion die Beschreibung, ein Satz zum Anfangen und der Link zur Seite */
export default async function HelpPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel } = await requireHotel(hotelId, "staff", "help");
  const rows = await moduleRows(hotel.id);
  const pages = new Map(allPages(adminNav(hotel, hiddenNavKeys(rows))).map((p) => [p.key, p.href]));
  const mods = MODULES.filter((m) => isOn(rows, m.key));
  const contact = env().EMAIL_FROM;
  return (
    <div className="stack">
      <h1>Hilfe</h1>
      <p className="muted">Was jede eingeschaltete Funktion kann und wie Sie anfangen. Ausgeschaltete Funktionen finden Sie unter «Funktionen».</p>
      {mods.map((m) => {
        const link = m.navKeys.map((k) => pages.get(k)).find(Boolean);
        return (
          <section key={m.key} className="card stack" id={m.key}>
            <h2>{m.label}</h2>
            <p>{m.description}</p>
            {HELP_START[m.key] ? <p><strong>So fangen Sie an:</strong> {HELP_START[m.key]}</p> : null}
            {link ? <p><a href={link}>Zur Seite</a></p> : null}
          </section>
        );
      })}
      <section className="card stack">
        <h2>Einrichtungshilfe</h2>
        <p>Wenn Sie Ihre bisherigen Daten übernehmen oder die Einrichtung begleiten lassen möchten, schreiben Sie uns. Das ist freiwillig und kostet nach Aufwand; vorab nennen wir Ihnen den Preis.</p>
        <p className="small muted">Schreiben Sie an die Adresse, von der Sie Ihre Pontivo-Mails erhalten ({contact}).</p>
      </section>
    </div>
  );
}
