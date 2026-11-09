import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { createImprintPage, createPage, deletePage, documentLibrary, ensureHomePage, listPages, movePage, removeDocument, SiteError } from "@/src/services/site";
import { publicBase, updateDesign, updateLanguages } from "@/src/services/brand";
import { hotelLocales, LOCALE_NAMES, LOCALES } from "@/src/i18n/dict";
import { translationEnabled, translationsLeft } from "@/src/services/translate";
import { FONTS, LAYOUTS, fontOf, layoutOf } from "@/src/domain/theme";
import { deleteImage } from "@/src/lib/storage";
import { fontVars } from "@/components/public/fonts";
import { ZodError } from "zod";
import { tr } from "@/src/domain/blocks";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<string | { to: string }>) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let r: string | { to: string };
  try {
    r = await fn(c);
  } catch (e) {
    if (e instanceof SiteError) r = `Nicht möglich: ${e.message}`;
    else if (e instanceof ZodError) r = `Nicht möglich: ${e.issues.map((i) => i.message).join(", ")}`;
    else throw e;
  }
  redirect(typeof r === "string" ? `/admin/${c.hotel.id}/site?msg=${encodeURIComponent(r)}` : r.to);
}

async function startHome(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => ({ to: `/admin/${hotel.id}/site/${(await ensureHomePage(hotel, actor)).id}` }));
}
async function newPage(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await ensureHomePage(hotel, actor);
    return { to: `/admin/${hotel.id}/site/${(await createPage(hotel.id, s(f, "title"), actor)).id}` };
  });
}
async function newImprint(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await ensureHomePage(hotel, actor);
    return { to: `/admin/${hotel.id}/site/${(await createImprintPage(hotel, actor)).id}?msg=${encodeURIComponent("Impressum angelegt – bitte die Angaben in [Klammern] ergänzen")}` };
  });
}
async function move(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await movePage(hotel.id, s(f, "pageId"), s(f, "dir") === "up" ? -1 : 1, actor);
    return "Reihenfolge geändert";
  });
}
async function remove(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await deletePage(hotel.id, s(f, "pageId"), actor);
    return "Seite gelöscht";
  });
}

async function saveDesign(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await updateDesign(hotel.id, { layout: s(f, "layout") as never, font: s(f, "font") as never }, actor);
    return { to: `/admin/${hotel.id}/site?msg=${encodeURIComponent("Gestaltung gespeichert")}#gestaltung` };
  });
}
async function saveLanguages(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    const langs = await updateLanguages(hotel.id, f.getAll("lang").map(String), actor);
    return { to: `/admin/${hotel.id}/site?msg=${encodeURIComponent(`Sprachen gespeichert: ${langs.map((l) => l.toUpperCase()).join(", ")}`)}#sprachen` };
  });
}
async function removeDoc(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await deleteImage(await removeDocument(hotel.id, s(f, "url"), actor));
    return { to: `/admin/${hotel.id}/site?msg=${encodeURIComponent("Dokument gelöscht")}#dokumente` };
  });
}

export default async function Site({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const pages = await listPages(hotel.id);
  const home = pages.find((p) => p.slug === "");
  const others = pages.filter((p) => p.slug !== "");
  const base = publicBase(hotel);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const bookingOnly = hotel.content.brand?.mode === "booking_only";
  const layout = layoutOf(hotel.content.brand?.layout);
  const font = fontOf(hotel.content.brand?.font);
  const docs = documentLibrary(hotel);
  const langs = hotelLocales(hotel);
  const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div className="stack">
      <h1>Website</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      {bookingOnly ? <p className="notice warn small">Dieses Hotel nutzt «nur Buchung» (siehe Einbinden). Seiten hier erscheinen trotzdem unter der Pontivo-Adresse, aber nicht im Menü der Buchungsseite.</p> : null}

      <section className="card stack">
        <h2>Startseite</h2>
        {home ? (
          <p><a className="btn" href={`/admin/${hotel.id}/site/${home.id}`}>Startseite bearbeiten</a> <a href={`${base}/de`} target="_blank">ansehen</a></p>
        ) : canEdit ? (
          <form action={startHome}>{hidden}<p className="small">Heute zeigt die Startseite Titel, Einleitung und Zimmer aus den Einstellungen. Mit dem Editor gestalten Sie sie frei aus Bausteinen – die bisherigen Texte werden übernommen.</p><button className="btn">Startseite gestalten</button></form>
        ) : null}
      </section>

      <section className="card stack" id="gestaltung">
        <h2>Gestaltung</h2>
        <p className="muted small">Layout und Schrift gelten für alle Seiten und die Buchungsstrecke. Hauptfarbe und Logo stellen Sie unter <a href={`/admin/${hotel.id}/embed`}>Einbinden</a> ein.</p>
        <form action={saveDesign} className="stack">
          {hidden}
          <fieldset className="plain" disabled={!canEdit}>
            <legend className="small muted">Layout</legend>
            <div className="choice-grid">
              {LAYOUTS.map((l) => (
                <label key={l.key} className="choice">
                  <input type="radio" name="layout" value={l.key} defaultChecked={l.key === layout} />
                  <span className={`layout-thumb thumb-${l.key}`} aria-hidden="true"><i /><b /><em /></span>
                  <strong>{l.label}</strong>
                  <span className="small muted">{l.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="plain" disabled={!canEdit} style={{ marginTop: 12 }}>
            <legend className="small muted">Schrift (Titel / Text)</legend>
            <div className="choice-grid">
              {FONTS.map((f) => (
                <label key={f.key} className="choice font-choice" style={fontVars(f.key) as React.CSSProperties}>
                  <input type="radio" name="font" value={f.key} defaultChecked={f.key === font} />
                  <strong>{f.label}</strong>
                  <span className="font-sample">Willkommen im Glarnerland</span>
                  <span className="small muted">{f.head} / {f.body}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {canEdit ? <div><button className="btn small">Gestaltung speichern</button> <a className="small" href={`${base}/de`} target="_blank">Website ansehen</a></div> : null}
        </form>
      </section>

      <section className="card stack" id="sprachen">
        <h2>Sprachen</h2>
        <p className="muted small">Deutsch ist immer dabei. Für jede weitere Sprache erscheint auf der Website ein Sprachwechsel, und Buchung, Bestätigungs-Mail und Stornoseite sind in der Sprache des Gastes. Fehlt ein Text in einer Sprache, zeigt die Website Englisch, sonst Deutsch.</p>
        <form action={saveLanguages} className="stack">
          {hidden}
          <fieldset className="plain" disabled={!canEdit}>
            <div className="weekdays">
              {LOCALES.map((l) => (
                <label key={l}><input type="checkbox" name="lang" value={l} defaultChecked={langs.includes(l)} disabled={l === "de"} />{LOCALE_NAMES[l]}</label>
              ))}
            </div>
          </fieldset>
          {canEdit ? <div><button className="btn small">Sprachen speichern</button></div> : null}
        </form>
        <p className="muted small">
          {translationEnabled()
            ? <>Texte übersetzen Sie im Editor jeder Seite mit «Fehlende Texte übersetzen», Zimmer und Tarife unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer</a>. Noch {translationsLeft(hotel)} automatische Übersetzungen diesen Monat.</>
            : <>Automatische Übersetzung ist noch nicht eingerichtet; die Felder können Sie im Editor von Hand ausfüllen.</>}
          {" "}AGB und Datenschutz erscheinen auf Französisch, Italienisch und Niederländisch vorerst auf Englisch.
        </p>
      </section>

      <section className="card stack" id="dokumente">
        <h2>Dokumente (PDF)</h2>
        <p className="muted small">Zum Beispiel Speisekarte, Preisliste, Seminarunterlagen. Auf einer Seite zeigen Sie sie mit dem Baustein «Downloads (PDF)».</p>
        {docs.length ? (
          <table className="table">
            <thead><tr><th>Titel</th><th>Grösse</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.url}>
                  <td><a href={d.url} target="_blank">{d.title.de || d.title.en}</a>{d.title.en && d.title.de ? <span className="muted small"> · EN: {d.title.en}</span> : null}</td>
                  <td className="small">{kb(d.bytes)}</td>
                  <td>{canEdit ? <form action={removeDoc}>{hidden}<input type="hidden" name="url" value={d.url} /><button className="btn secondary small">Löschen</button></form> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">Noch keine Dokumente.</p>}
        {canEdit ? (
          <form action={`/api/admin/hotels/${hotel.id}/documents`} method="post" encType="multipart/form-data" className="inline-form">
            <div><label>PDF-Datei (max. 15 MB)</label><input type="file" name="file" accept="application/pdf,.pdf" required /></div>
            {langs.map((l) => (
              <div key={l}><label>Titel {l.toUpperCase()}</label><input name={`title.${l}`} placeholder={l === "de" ? "z. B. Speisekarte" : l === "en" ? "z. B. Menu" : ""} maxLength={120} /></div>
            ))}
            <button className="btn small">Hochladen</button>
          </form>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Weitere Seiten</h2>
        {others.length ? (
          <table className="table">
            <thead><tr><th>Seite</th><th>Adresse</th><th>Menü</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {others.map((p, i) => (
                <tr key={p.id}>
                  <td><a href={`/admin/${hotel.id}/site/${p.id}`}>{tr(p.title, "de") || tr(p.title, "en")}</a></td>
                  <td className="small"><a href={`${base}/de/${p.slug}`} target="_blank">/{p.slug}</a></td>
                  <td>{p.showInNav ? "ja" : "nein"}</td>
                  <td>{p.published ? "sichtbar" : <span className="badge warn">Entwurf</span>}</td>
                  <td>
                    {canEdit ? (
                      <div className="inline-form" style={{ gap: 4 }}>
                        <form action={move}>{hidden}<input type="hidden" name="pageId" value={p.id} /><input type="hidden" name="dir" value="up" /><button className="btn secondary small" disabled={i === 0} aria-label="nach oben">↑</button></form>
                        <form action={move}>{hidden}<input type="hidden" name="pageId" value={p.id} /><input type="hidden" name="dir" value="down" /><button className="btn secondary small" disabled={i === others.length - 1} aria-label="nach unten">↓</button></form>
                        <form action={remove}>{hidden}<input type="hidden" name="pageId" value={p.id} /><button className="btn secondary small">Löschen</button></form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">Noch keine weiteren Seiten. Typisch sind z. B. Restaurant, Lage & Anreise, Angebote, Seminare.</p>}
        {canEdit ? (
          <div className="inline-form">
            <form action={newPage} className="inline-form">{hidden}<div><label>Neue Seite</label><input name="title" placeholder="z. B. Restaurant" required /></div><button className="btn small">Anlegen</button></form>
            {!others.some((p) => p.slug === "impressum") ? <form action={newImprint}>{hidden}<button className="btn secondary small">Impressum anlegen</button></form> : null}
          </div>
        ) : null}
        <p className="muted small">Die Reihenfolge hier ist die Reihenfolge im Menü. AGB und Datenschutz gibt es automatisch.</p>
      </section>
    </div>
  );
}
