import { requireHotel } from "@/src/auth/guard";
import { adminNav, allPages } from "@/src/admin/nav";
import { TERM_GROUPS, TERMS } from "@/src/domain/help-content";
import { hiddenNavKeys } from "@/src/domain/modules";
import { moduleRows } from "@/src/services/modules";

export const dynamic = "force-dynamic";

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9äöü]+/g, "-").replace(/^-|-$/g, "");

/** Fachbegriffe: was etwas bedeutet und wie Pontivo es löst */
export default async function TermsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel } = await requireHotel(hotelId, "staff", "helpterms");
  const pages = new Map(allPages(adminNav(hotel, hiddenNavKeys(await moduleRows(hotel.id)))).map((p) => [p.key, p.href]));
  return (
    <div className="stack">
      <h1>Fachbegriffe</h1>
      <p className="muted">Was ein Begriff in der Hotellerie bedeutet und wie Pontivo ihn umsetzt.</p>
      <nav className="chips" aria-label="Begriffe">
        {TERMS.map((t) => <a key={t.term} href={`#${slug(t.term)}`} className="chip-link">{t.term.split(" (")[0]}</a>)}
      </nav>
      {TERM_GROUPS.map((g) => (
        <section key={g} className="stack">
          <h2>{g}</h2>
          {TERMS.filter((t) => t.group === g).map((t) => (
            <article key={t.term} className="card stack" id={slug(t.term)}>
              <h3 style={{ margin: 0 }}>{t.term}</h3>
              <p style={{ margin: 0 }}><strong>Was es bedeutet:</strong> {t.meaning}</p>
              <p style={{ margin: 0 }}><strong>So löst es Pontivo:</strong> {t.inPontivo}</p>
              {t.area && pages.get(t.area) ? <p style={{ margin: 0 }}><a href={pages.get(t.area)}>Zur Seite</a></p> : null}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
