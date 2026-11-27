import { requireHotel } from "@/src/auth/guard";
import { TERM_GROUPS, TERMS } from "@/src/domain/help-content";
import { helpContext } from "@/src/services/help";

export const dynamic = "force-dynamic";

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9äöü]+/g, "-").replace(/^-|-$/g, "");

/** Fachbegriffe (SPEC 19.65): nur was zum Betrieb passt (Unterkunft, Gastronomie), Begriffe weiterer Funktionen kurz darunter */
export default async function TermsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "helpterms");
  const ctx = await helpContext(hotel, role);
  const shown = TERMS.filter(ctx.termShown);
  const more = TERMS.filter(ctx.termMore);
  const groups = TERM_GROUPS.filter((g) => shown.some((t) => t.group === g));
  return (
    <div className="stack">
      <h1>Fachbegriffe</h1>
      <p className="muted m0">Was ein Begriff bedeutet und wie Pontivo ihn umsetzt.</p>
      <nav className="card stack" aria-label="Begriffe">
        {groups.map((g) => (
          <div key={g} className="small"><strong>{g}:</strong> {shown.filter((t) => t.group === g).map((t, i) => <span key={t.term}>{i ? " · " : ""}<a href={`#${slug(t.term)}`}>{t.term.split(" (")[0]}</a></span>)}</div>
        ))}
      </nav>
      {groups.map((g) => (
        <section key={g} className="stack">
          <h2>{g}</h2>
          {shown.filter((t) => t.group === g).map((t) => (
            <article key={t.term} className="card stack" id={slug(t.term)}>
              <h3 className="m0">{t.term}</h3>
              <p className="m0"><strong>Was es bedeutet:</strong> {t.meaning}</p>
              <p className="m0"><strong>So löst es Pontivo:</strong> {t.inPontivo}</p>
              {t.area && ctx.allowed(t.area) ? <p className="m0"><a href={ctx.pages.get(t.area)}>Zur Seite</a></p> : null}
            </article>
          ))}
        </section>
      ))}
      {more.length ? (
        <section className="card stack" data-testid="terms-more">
          <h2>Begriffe zu weiteren Funktionen</h2>
          <p className="muted small m0">Diese Begriffe brauchen Sie erst, wenn die Funktion eingeschaltet ist.</p>
          <ul className="m0">{more.map((t) => <li key={t.term}><strong>{t.term}</strong>: {t.meaning} <span className="muted small">· Funktion «{ctx.offModule(t.area!)!.label}»</span></li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
