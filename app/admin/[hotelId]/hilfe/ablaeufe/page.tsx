import { requireHotel } from "@/src/auth/guard";
import { guideRole, GUIDE_ROLE_LABEL } from "@/src/domain/guide";
import { FLOW_SECTIONS, flowScope, flowsFor } from "@/src/domain/help-content";
import { atLeast } from "@/src/domain/roles";
import { helpContext } from "@/src/services/help";

export const dynamic = "force-dynamic";

/** Abläufe Schritt für Schritt (SPEC 19.65): nach Bereich gegliedert, nur was der Betrieb hat und die Rolle braucht; darunter Abläufe weiterer Funktionen */
export default async function FlowsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "helpflows");
  const ctx = await helpContext(hotel, role);
  const me = guideRole(role);
  const flows = flowsFor(me).filter((f) => ctx.allowed(f.area) && ctx.inScope(flowScope(f)));
  const sections = FLOW_SECTIONS.filter((s) => flows.some((f) => f.section === s));
  // Abläufe weiterer Funktionen, nach Funktion gruppiert («both»: z. B. Halbpension nur, wenn der Betrieb Zimmer hat)
  const more = flowsFor(me).filter((f) => !ctx.pages.has(f.area) && ctx.offModule(f.area) && (flowScope(f) !== "both" || ctx.lodging) && (flowScope(f) !== "lodging" || ctx.lodging));
  const moreBy = [...new Set(more.map((f) => ctx.offModule(f.area)!.label))].map((label) => ({ label, flows: more.filter((f) => ctx.offModule(f.area)!.label === label) }));
  const base = `/admin/${hotel.id}`;
  return (
    <div className="stack">
      <h1>Abläufe</h1>
      <p className="muted m0">Der Alltag Schritt für Schritt{me === "owner" ? "" : ` für Ihre Rolle (${GUIDE_ROLE_LABEL[me]})`}. Was ein Begriff bedeutet, steht unter <a href={`${base}/hilfe/begriffe`}>Fachbegriffe</a>.</p>
      {sections.length > 1 ? (
        <nav className="card stack" aria-label="Inhalt">
          {sections.map((s) => (
            <div key={s} className="small"><strong>{s}:</strong> {flows.filter((f) => f.section === s).map((f, i) => <span key={f.key}>{i ? " · " : ""}<a href={`#${f.key}`}>{f.title}</a></span>)}</div>
          ))}
        </nav>
      ) : null}
      {sections.map((s) => (
        <section key={s} className="stack">
          <h2>{s}</h2>
          {flows.filter((f) => f.section === s).map((f) => (
            <article key={f.key} className="card stack" id={f.key}>
              <h3 className="m0">{f.title}</h3>
              <p className="muted m0">{f.goal}</p>
              <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>{f.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
              {f.tip ? <p className="notice small m0"><strong>Gut zu wissen:</strong> {f.tip}</p> : null}
              <p className="m0"><a className="btn secondary small" href={ctx.pages.get(f.area)}>Seite öffnen</a></p>
            </article>
          ))}
        </section>
      ))}
      {more.length ? (
        <section className="card stack" data-testid="flows-more">
          <h2>Mit weiteren Funktionen</h2>
          <p className="muted small m0">Diese Abläufe gibt es, sobald die genannte Funktion eingeschaltet ist{atLeast(role, "manager") ? <> (<a href={`${base}/funktionen`}>Einstellungen → Funktionen</a>)</> : " (fragen Sie die Inhaberin oder den Inhaber)"}.</p>
          <ul className="m0 stack" style={{ gap: 6 }}>{moreBy.map((g) => <li key={g.label}><strong>{g.label}:</strong> {g.flows.map((f) => f.title).join(" · ")}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
