import { requireHotel } from "@/src/auth/guard";
import { adminNav, allPages } from "@/src/admin/nav";
import { guideRole, HELP_START } from "@/src/domain/guide";
import { WAYFINDING } from "@/src/domain/help-content";
import { hiddenNavKeys, isOn, MODULES } from "@/src/domain/modules";
import { areasOf, isLimitedRole } from "@/src/domain/roles";
import { moduleRows } from "@/src/services/modules";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** Hilfe: Wegweiser durch das Menü, danach je eingeschaltete Funktion die Beschreibung und ein Satz zum Anfangen */
export default async function HelpPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "help");
  const rows = await moduleRows(hotel.id);
  const pages = new Map(allPages(adminNav(hotel, hiddenNavKeys(rows))).map((p) => [p.key, p.href]));
  const allowed = (k: string) => !isLimitedRole(role) || areasOf(role).includes(k);
  const way = WAYFINDING.filter((w) => pages.has(w.area) && allowed(w.area));
  const mods = MODULES.filter((m) => isOn(rows, m.key) && m.navKeys.some((k) => pages.has(k) && allowed(k)) || (isOn(rows, m.key) && !isLimitedRole(role) && m.navKeys.length === 0));
  const contact = env().EMAIL_FROM;
  const me = guideRole(role);
  const base = `/mypontivo/${hotel.id}`;
  return (
    <div className="stack">
      <h1>Hilfe</h1>
      <section className="card stack">
        <h2>Neu im Team? So kommen Sie gut an</h2>
        <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
          <li><a href={`${base}/erste-woche`}>Erste Woche</a>: Ihre Checkliste, Aufgabe für Aufgabe, jede führt an die richtige Stelle.</li>
          <li>Unten der <strong>Wegweiser</strong>: was Sie wo finden.</li>
          <li><a href={`${base}/hilfe/ablaeufe`}>Abläufe</a>: der Alltag Schritt für Schritt{me === "owner" ? "" : " für Ihre Rolle"}.</li>
          <li><a href={`${base}/hilfe/begriffe`}>Fachbegriffe</a>: was ein Begriff bedeutet und wie Pontivo ihn löst.</li>
        </ol>
        <p className="muted small" style={{ margin: 0 }}>Nichts kann kaputtgehen: Buchungen, Rechnungen und Abschlüsse werden nie gelöscht, Korrekturen sind Gegenbuchungen. Im Zweifel fragen Sie die Inhaberin oder den Inhaber.</p>
      </section>

      <section className="stack">
        <h2>Wegweiser: was finde ich wo?</h2>
        <div className="grid">
          {way.map((w) => (
            <article key={w.area} className="card stack">
              <h3 style={{ margin: 0 }}>{w.title}</h3>
              <p style={{ margin: 0 }}>{w.what}</p>
              {w.notThis ? <p className="muted small" style={{ margin: 0 }}>{w.notThis}</p> : null}
              <p style={{ margin: 0 }}><a href={pages.get(w.area)}>Öffnen</a></p>
            </article>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Kalender oder Buchungen?</h2>
        <div className="card stack">
          <p style={{ margin: 0 }}><strong>Kalender</strong> beantwortet: <em>Wie viele Zimmer sind frei, und was kosten sie?</em> Er zeigt pro Zimmertyp und Nacht die freien Zimmer, die Preise und die Regeln. Hier ändern Sie Preise und sperren Zimmer. Er sagt Ihnen auch, wie viele Zimmer ausgebucht sind, aber nicht von wem.</p>
          <p style={{ margin: 0 }}><strong>Buchungen</strong> beantwortet: <em>Wer kommt, was hat er bezahlt, was ist noch offen?</em> Jede Buchung ist ein Vorgang mit Gast, Zahlung, Storno und Rechnung.</p>
          <p className="muted small" style={{ margin: 0 }}>Faustregel: Geht es um Zimmer und Tage, ist es der Kalender. Geht es um eine Person oder einen Betrag, sind es die Buchungen.</p>
        </div>
      </section>

      <section className="stack">
        <h2>Funktionen im Detail</h2>
        <p className="muted small" style={{ margin: 0 }}>Was jede eingeschaltete Funktion kann und wie Sie anfangen. Ausgeschaltete finden Sie unter Einstellungen → Funktionen.</p>
        {mods.map((m) => {
          const link = m.navKeys.map((k) => pages.get(k)).find(Boolean);
          return (
            <section key={m.key} className="card stack" id={m.key}>
              <h3 style={{ margin: 0 }}>{m.label}</h3>
              <p style={{ margin: 0 }}>{m.description}</p>
              {HELP_START[m.key] ? <p style={{ margin: 0 }}><strong>So fangen Sie an:</strong> {HELP_START[m.key]}</p> : null}
              {link ? <p style={{ margin: 0 }}><a href={link}>Zur Seite</a></p> : null}
            </section>
          );
        })}
      </section>

      <section className="card stack">
        <h2>Einrichtungshilfe</h2>
        <p>Wenn Sie Ihre bisherigen Daten übernehmen oder die Einrichtung begleiten lassen möchten, schreiben Sie uns. Das ist freiwillig und kostet nach Aufwand; vorab nennen wir Ihnen den Preis.</p>
        <p className="small muted">Schreiben Sie an die Adresse, von der Sie Ihre Pontivo-Mails erhalten ({contact}).</p>
      </section>
    </div>
  );
}
