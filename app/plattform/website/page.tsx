import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/src/auth/guard";
import { DEFAULT_FAQ, MAX_FAQ, SITE_FIELDS, type SiteField } from "@/src/domain/pontivo-site";
import { getSiteOverrides, resetSiteOverrides, saveSiteOverrides } from "@/src/services/platform-site";

export const dynamic = "force-dynamic";

async function save(f: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const texts: Record<string, string> = {};
  for (const fld of SITE_FIELDS) texts[fld.key] = String(f.get(`t:${fld.key}`) ?? "");
  const faq = Array.from({ length: MAX_FAQ }, (_, i) => ({ q: String(f.get(`q:${i}`) ?? ""), a: String(f.get(`a:${i}`) ?? "") }));
  await saveSiteOverrides({ texts, faq }, `user:${admin.id}`);
  redirect("/plattform/website?saved=1");
}

async function reset() {
  "use server";
  const admin = await requirePlatformAdmin();
  await resetSiteOverrides(`user:${admin.id}`);
  redirect("/plattform/website?reset=1");
}

export default async function WebsiteEditor({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const o = await getSiteOverrides();
  const groups = [...new Set(SITE_FIELDS.map((x) => x.group))];
  const faq = o?.faq ?? DEFAULT_FAQ;
  const rows = [...faq, ...Array.from({ length: 3 }, () => ({ q: "", a: "" }))].slice(0, MAX_FAQ);
  const field = (x: SiteField) => {
    const v = o?.texts[x.key] ?? x.default;
    const changed = x.key in (o?.texts ?? {});
    return (
      <div key={x.key}>
        <label htmlFor={`t:${x.key}`}>{x.label}{changed ? " (geändert)" : ""}</label>
        {x.multiline
          ? <textarea id={`t:${x.key}`} name={`t:${x.key}`} defaultValue={v} rows={Math.min(8, Math.max(2, Math.ceil(v.length / 90)))} maxLength={1500} />
          : <input id={`t:${x.key}`} name={`t:${x.key}`} defaultValue={v} maxLength={1500} />}
      </div>
    );
  };
  return (
    <div className="u-maxw-820px">
      <p><a href="/" target="_blank">Startseite ansehen ↗</a></p>
      <h1>Texte der Pontivo-Website</h1>
      <section className="card stack">
        <h2>Seiten</h2>
        <p className="small">Startseite <a href="/" target="_blank">/</a> (Dachmarke) · Unterkünfte <a href="/unterkunft" target="_blank">/unterkunft</a> (Texte unten) · Restaurants <a href="/restaurant" target="_blank">/restaurant</a>.</p>
      </section>
      <p className="muted">Hier änderst du die Texte der Seite für Unterkünfte. Änderungen sind sofort sichtbar. Ein Feld auf den ursprünglichen Text zurückzusetzen heisst: den alten Text wieder eintragen oder das Feld leeren. Platzhalter: <code>{"{name}"}</code> (Plattformname), <code>{"{fee}"}</code> (Gebühr in Prozent), <code>{"{emailTo}"}</code> (« an info@…», leer ohne Adresse). Impressum, Datenschutz und Bedingungen bearbeitest du nicht hier (rechtliche Texte), ebenso die einzelnen Funktionskarten.</p>
      {sp.saved ? <p className="notice">Gespeichert.</p> : null}
      {sp.reset ? <p className="notice">Alle Texte stehen wieder auf dem Standard.</p> : null}
      <form action={save} className="stack">
        {groups.map((g) => (
          <fieldset key={g} className="card stack">
            <legend><strong>{g}</strong></legend>
            {SITE_FIELDS.filter((x) => x.group === g).map(field)}
            {g === "Häufige Fragen" ? (
              <div className="stack">
                <p className="small muted">Fragen und Antworten in der gewünschten Reihenfolge. Eine Zeile mit leerer Frage oder leerer Antwort wird weggelassen. Unten sind drei leere Zeilen für neue Fragen.</p>
                {rows.map((r, i) => (
                  <div key={i} className="stack u-bt2-1px-solid-var-line-ddd u-pt-8px">
                    <input name={`q:${i}`} defaultValue={r.q} placeholder="Frage" aria-label={`Frage ${i + 1}`} maxLength={300} />
                    <textarea name={`a:${i}`} defaultValue={r.a} placeholder="Antwort" aria-label={`Antwort ${i + 1}`} rows={3} maxLength={1500} />
                  </div>
                ))}
              </div>
            ) : null}
          </fieldset>
        ))}
        <div><button className="btn">Speichern</button></div>
      </form>
      <form className="mt24" action={reset}>
        <button className="btn secondary small">Alle Texte auf Standard zurücksetzen</button>
      </form>
    </div>
  );
}
