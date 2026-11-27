import { requireHotel } from "@/src/auth/guard";
import { guideRole, GUIDE_ROLE_LABEL, HELP_START, progress, tasksFor } from "@/src/domain/guide";
import { FLOW_SECTIONS, flowScope, flowsFor, WAYFINDING, type Flow, type Scope } from "@/src/domain/help-content";
import { isOn, MODULES } from "@/src/domain/modules";
import { atLeast } from "@/src/domain/roles";
import { doneTasks } from "@/src/services/guide";
import { firstSentence, helpContext } from "@/src/services/help";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

const GROUPS: { scope: Scope; title: string }[] = [
  { scope: "lodging", title: "Unterkunft" },
  { scope: "dining", title: "Gastronomie" },
  { scope: "all", title: "Einstellungen und Konto" },
];

/**
 * Hilfe (SPEC 19.65): Einstieg je Rolle, Wegweiser nur mit dem, was der Betrieb hat und die Person sehen darf,
 * eingeschaltete Funktionen mit «So fangen Sie an» und darunter «Weitere Funktionen», die zur Betriebsart passen.
 */
export default async function HelpPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role, user } = await requireHotel(hotelId, "staff", "help");
  const ctx = await helpContext(hotel, role);
  const base = `/admin/${hotel.id}`;
  const me = guideRole(role);
  const manager = atLeast(role, "manager");
  const visible = new Set([...ctx.pages.keys(), "konto"]);
  const tasks = tasksFor(role, visible);
  const p = progress(tasks, await doneTasks(hotel.id, user.id));
  // Abläufe in der Reihenfolge der Abschnitte (Rezeption, Restaurant …); Hotel mit Restaurant: abwechselnd aus beiden Bereichen
  const mineFlows = flowsFor(me).filter((f) => ctx.allowed(f.area) && ctx.inScope(flowScope(f))).sort((a, b) => FLOW_SECTIONS.indexOf(a.section) - FLOW_SECTIONS.indexOf(b.section));
  const byScope = (sc: Scope) => mineFlows.filter((f) => flowScope(f) === sc);
  const lists: Flow[][] = ctx.lodging && ctx.dining ? [byScope("lodging"), byScope("dining")] : [mineFlows];
  const top: Flow[] = [];
  for (let i = 0; top.length < 4 && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i] && top.length < 4) top.push(l[i]);
  for (const f of mineFlows) if (top.length < 4 && !top.includes(f)) top.push(f);
  const way = WAYFINDING.filter((w) => ctx.inScope(w.scope) && (w.area === "konto" || ctx.allowed(w.area)));
  const mine = MODULES.filter((m) => isOn(ctx.rows, m.key) && ctx.relevant.includes(m.key) && (m.navKeys.some((k) => ctx.allowed(k)) || (manager && m.navKeys.length === 0)));
  // Abläufe, die eine weitere Funktion mitbringt (Zimmer-Abläufe nur bei Betrieben mit Zimmern)
  const flowsOf = (moduleKey: string) => flowsFor("owner").filter((f) => ctx.moduleOf(f.area)?.key === moduleKey && (ctx.lodging || (flowScope(f) !== "lodging" && flowScope(f) !== "both")));
  return (
    <div className="stack">
      <h1>Hilfe</h1>

      <section className="card stack" data-testid="help-start">
        <h2>Ihr Einstieg als {GUIDE_ROLE_LABEL[me]}</h2>
        <ol className="help-steps">
          <li><a href={`${base}/erste-woche`}><strong>Erste Woche</strong></a>: Ihre Checkliste, jede Aufgabe führt an die richtige Stelle. {p.total ? <span className="badge">{p.done} von {p.total} erledigt</span> : null}</li>
          {top.length ? (
            <li><strong>Ihre wichtigsten Abläufe</strong>, Schritt für Schritt:
              <ul>{top.map((f) => <li key={f.key}><a href={`${base}/hilfe/ablaeufe#${f.key}`}>{f.title}</a></li>)}</ul>
              <a className="small" href={`${base}/hilfe/ablaeufe`}>Alle Abläufe{me === "owner" ? "" : " für Ihre Rolle"}</a>
            </li>
          ) : null}
          <li><a href="#wegweiser"><strong>Wegweiser</strong></a>: was Sie wo im Menü finden.</li>
          <li><a href={`${base}/hilfe/begriffe`}><strong>Fachbegriffe</strong></a>: was ein Begriff bedeutet und wie Pontivo ihn löst.</li>
        </ol>
        <p className="muted small m0">Nichts kann kaputtgehen: Buchungen, Rechnungen, Bons und Abschlüsse werden nie gelöscht, Korrekturen sind Gegenbuchungen. Im Zweifel fragen Sie die Inhaberin oder den Inhaber.</p>
      </section>

      <section className="stack" id="wegweiser">
        <h2>Wegweiser: was finde ich wo?</h2>
        {GROUPS.map((g) => {
          const list = way.filter((w) => w.scope === g.scope);
          if (!list.length) return null;
          return (
            <div key={g.scope} className="stack">
              {ctx.lodging && ctx.dining && g.scope !== "all" ? <h3 className="m0">{g.title}</h3> : g.scope === "all" ? <h3 className="m0">{g.title}</h3> : null}
              <div className="grid">
                {list.map((w) => (
                  <article key={w.area} className="card stack">
                    <h4 className="m0">{w.title}</h4>
                    <p className="m0">{!ctx.lodging && w.whatRestaurant ? w.whatRestaurant : w.what}</p>
                    {w.notThis ? <p className="muted small m0">{w.notThis}</p> : null}
                    <p className="m0"><a href={w.area === "konto" ? `${base}/konto` : ctx.pages.get(w.area)}>Öffnen</a></p>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {ctx.lodging && ctx.allowed("calendar") && ctx.allowed("bookings") ? (
        <section className="card stack">
          <h2>Kalender oder Buchungen?</h2>
          <p className="m0"><strong>Kalender</strong> beantwortet: <em>Wie viele Zimmer sind frei, und was kosten sie?</em> Er zeigt pro Zimmertyp und Nacht die freien Zimmer, die Preise und die Regeln.</p>
          <p className="m0"><strong>Buchungen</strong> beantwortet: <em>Wer kommt, was hat er bezahlt, was ist noch offen?</em> Jede Buchung ist ein Vorgang mit Gast, Zahlung, Storno und Rechnung.</p>
          <p className="muted small m0">Faustregel: Geht es um Zimmer und Tage, ist es der Kalender. Geht es um eine Person oder einen Betrag, sind es die Buchungen.</p>
        </section>
      ) : null}

      <section className="stack" id="funktionen">
        <h2>Ihre Funktionen</h2>
        <p className="muted small m0">Was in Ihrem Betrieb eingeschaltet ist{manager ? "" : " und Sie nutzen dürfen"}, und wie Sie anfangen.</p>
        <div className="grid">
          {mine.map((m) => {
            const link = m.navKeys.map((k) => (ctx.allowed(k) ? ctx.pages.get(k) : undefined)).find(Boolean);
            return (
              <article key={m.key} className="card stack" id={m.key}>
                <h3 className="m0">{m.label}</h3>
                <p className="m0 small">{firstSentence(m.description)}</p>
                {HELP_START[m.key] ? <p className="m0 small"><strong>So fangen Sie an:</strong> {HELP_START[m.key]}</p> : null}
                {link ? <p className="m0"><a href={link}>Zur Seite</a></p> : null}
              </article>
            );
          })}
        </div>
      </section>

      {ctx.more.length ? (
        <section className="card stack" id="weitere" data-testid="help-more">
          <h2>Weitere Funktionen für Ihren Betrieb</h2>
          <p className="muted small m0">Diese Funktionen passen zu Ihrem Betrieb, sind aber ausgeschaltet. {manager ? <>Einschalten unter <a href={`${base}/funktionen`}>Einstellungen → Funktionen</a>; Ihre Daten bleiben beim Aus- und Einschalten erhalten.</> : "Möchten Sie eine davon nutzen, fragen Sie die Inhaberin oder den Inhaber."}</p>
          <ul className="plan-list">
            {ctx.more.map((m) => {
              const fl = flowsOf(m.key);
              return (
                <li key={m.key} className="plan-row help-more-row">
                  <span><strong>{m.label}</strong><br /><span className="small muted">{firstSentence(m.description)}{fl.length ? ` Abläufe: ${fl.map((f) => f.title).join(", ")}.` : ""}</span></span>
                  {manager ? <a className="btn secondary small" href={`${base}/funktionen#m-${m.key}`}>Ansehen</a> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {manager ? (
        <section className="card stack">
          <h2>Einrichtungshilfe</h2>
          <p className="m0">Wenn Sie Ihre bisherigen Daten übernehmen oder die Einrichtung begleiten lassen möchten, schreiben Sie uns. Das ist freiwillig und kostet nach Aufwand; vorab nennen wir Ihnen den Preis.</p>
          <p className="small muted m0">Schreiben Sie an die Adresse, von der Sie Ihre Pontivo-Mails erhalten ({env().EMAIL_FROM}).</p>
        </section>
      ) : null}
    </div>
  );
}
