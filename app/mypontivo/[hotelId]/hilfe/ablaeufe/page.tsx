import { requireHotel } from "@/src/auth/guard";
import { adminNav, allPages } from "@/src/admin/nav";
import { guideRole, GUIDE_ROLE_LABEL } from "@/src/domain/guide";
import { flowsFor } from "@/src/domain/help-content";
import { hiddenNavKeys } from "@/src/domain/modules";
import { moduleRows } from "@/src/services/modules";

export const dynamic = "force-dynamic";

/** Abläufe Schritt für Schritt, für die Rolle der Person (Inhaber sehen alle) */
export default async function FlowsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "helpflows");
  const pages = new Map(allPages(adminNav(hotel, hiddenNavKeys(await moduleRows(hotel.id)))).map((p) => [p.key, p.href]));
  const me = guideRole(role);
  const flows = flowsFor(me).filter((f) => pages.has(f.area));
  return (
    <div className="stack">
      <h1>Abläufe</h1>
      <p className="muted">Der Alltag Schritt für Schritt{me === "owner" ? "" : ` für Ihre Rolle (${GUIDE_ROLE_LABEL[me]})`}. Was Ihnen ein Begriff sagt, steht unter <a href={`/mypontivo/${hotel.id}/hilfe/begriffe`}>Fachbegriffe</a>.</p>
      {flows.map((f) => (
        <article key={f.key} className="card stack" id={f.key}>
          <h2 style={{ margin: 0 }}>{f.title}</h2>
          <p className="muted" style={{ margin: 0 }}>{f.goal}</p>
          <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>{f.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
          {f.tip ? <p className="notice small" style={{ margin: 0 }}><strong>Gut zu wissen:</strong> {f.tip}</p> : null}
          <p style={{ margin: 0 }}><a className="btn secondary small" href={pages.get(f.area)}>Seite öffnen</a></p>
        </article>
      ))}
    </div>
  );
}
