import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { createImprintPage, createPage, deletePage, documentLibrary, ensureHomePage, listPages, movePage, removeDocument, SiteError } from "@/src/services/site";
import { publicBase, setLogo, updateBrand, updateDesign, updateLanguages } from "@/src/services/brand";
import { env } from "@/src/env";
import { CopyBox } from "@/components/admin/CopyBox";
import { PhotoManager } from "@/components/admin/PhotoManager";
import { WidgetPreview } from "@/components/admin/WidgetPreview";
import { hotelLocales, LOCALE_NAMES, LOCALES } from "@/src/i18n/dict";
import { translationEnabled, translationsLeft } from "@/src/services/translate";
import { FONTS, LAYOUTS, fontOf, layoutOf } from "@/src/domain/theme";
import { deleteImage } from "@/src/lib/storage";
import { fontVars } from "@/components/public/fonts";
import { ZodError } from "zod";
import { tr } from "@/src/domain/blocks";

import { goLiveProblems, setHotelStatus, updateHotelIntro } from "@/src/services/settings";

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

async function changeStatus(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  const status = s(f, "status") as "live" | "paused" | "draft";
  let msg = `Status: ${status}`;
  try {
    await setHotelStatus(hotel, status, actor);
  } catch (e) {
    msg = `Nicht möglich: ${(e as Error).message}`;
  }
  redirect(`/admin/${hotel.id}/site?msg=${encodeURIComponent(msg)}`);
}

async function saveIntro(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await updateHotelIntro(hotel, { headlineDe: s(f, "headlineDe"), introDe: s(f, "introDe"), headlineEn: s(f, "headlineEn"), introEn: s(f, "introEn") }, actor);
    return { to: `/admin/${hotel.id}/site?msg=${encodeURIComponent("Gespeichert")}` };
  });
}

/** Wie wird Pontivo genutzt (eigene Website oder nur Buchung), Hauptfarbe, Adresse der eigenen Website */
async function saveBrand(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await updateBrand(hotel, {
      mode: f.get("mode") === "booking_only" ? "booking_only" : "website",
      color: String(f.get("useColor")) === "on" ? String(f.get("color")) : null,
      websiteUrl: String(f.get("websiteUrl") ?? "").trim() || null,
    }, actor);
    return { to: `/admin/${hotel.id}/site?msg=${encodeURIComponent("Gespeichert")}#betriebsart` };
  });
}

async function removeLogo(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    const old = await setLogo(hotel.id, null, actor);
    if (old) await deleteImage(old);
    return { to: `/admin/${hotel.id}/site?msg=${encodeURIComponent("Logo entfernt")}#logo` };
  });
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
  const isOwner = atLeast(role, "owner");
  const restaurantKind = hotel.propertyType === "restaurant";
  const problems = await goLiveProblems(hotel);
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

  const brand = hotel.content.brand ?? {};
  const lang = hotel.defaultLanguage === "en" ? "en" : "de";
  const scriptSrc = `${env().APP_BASE_URL}/widget/${hotel.slug}.js`;
  const link = `${base}/${lang}`;
  const button = `<div data-pontivo="${hotel.slug}" data-mode="button"></div>\n<script src="${scriptSrc}" async></script>`;
  const search = `<div data-pontivo="${hotel.slug}" data-mode="search"></div>\n<script src="${scriptSrc}" async></script>`;

  return (
    <div className="stack">
      <h1>Website & Buchung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}

      <section className="card stack" id="online-buchung">
        <h2>{restaurantKind ? "Website online" : "Online-Buchung"}</h2>
        <p>Status: <span className={`badge ${hotel.status === "live" ? "" : "warn"}`}>{hotel.status === "live" ? "live" : hotel.status === "paused" ? "pausiert" : "Entwurf"}</span> {hotel.primaryDomain ? <span className="muted small">· Domain {hotel.primaryDomain}</span> : null}</p>
        {problems.length ? <ul className="notice warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
        {isOwner ? (
          <div className="inline-form">
            {hotel.status !== "live" ? <form action={changeStatus}>{hidden}<input type="hidden" name="status" value="live" /><button className="btn" disabled={problems.length > 0}>Live schalten</button></form> : null}
            {hotel.status === "live" ? <form action={changeStatus}>{hidden}<input type="hidden" name="status" value="paused" /><button className="btn secondary">Pausieren</button></form> : null}
          </div>
        ) : <p className="muted small">Live schalten und pausieren kann nur der Inhaber.</p>}
      </section>

      <section className="card stack" id="betriebsart">
        <h2>Wie nutzen Sie {env().PLATFORM_NAME}?</h2>
        <form action={saveBrand} className="stack">
          {hidden}
          <div className="mode-pick">
            <label>
              <input type="radio" name="mode" value="booking_only" defaultChecked={bookingOnly} disabled={!canEdit} />
              <span><strong>Wir behalten unsere Website</strong><span className="muted small">{env().PLATFORM_NAME} übernimmt nur die Buchung. Der Gast kommt über einen Knopf auf unserer Website zur Buchungsseite.</span></span>
            </label>
            <label>
              <input type="radio" name="mode" value="website" defaultChecked={!bookingOnly} disabled={!canEdit} />
              <span><strong>{env().PLATFORM_NAME} ist unsere Website</strong><span className="muted small">Startseite, Zimmer und Buchung unter unserer eigenen Domain.</span></span>
            </label>
          </div>
          <div className="form-grid">
            <div><label htmlFor="f1c501">Adresse der eigenen Website</label><input id="f1c501" name="websiteUrl" type="url" placeholder="https://www.hotel.ch" defaultValue={brand.websiteUrl ?? ""} disabled={!canEdit} /></div>
            <div>
              <label>Hauptfarbe (Knöpfe, Links)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input name="color" type="color" defaultValue={brand.color ?? "#2f5d50"} style={{ width: 64, height: 42, padding: 2 }} disabled={!canEdit} />
                <label className="check m0"><input type="checkbox" name="useColor" defaultChecked={!!brand.color} disabled={!canEdit} />verwenden</label>
              </div>
            </div>
          </div>
          {canEdit ? <button className="btn">Speichern</button> : null}
        </form>
        <p className="muted small m0">Je nach Auswahl zeigt diese Seite nur, was Sie brauchen: mit eigener Website die Einbindung in Ihre Seite, mit {env().PLATFORM_NAME} als Website zusätzlich Startseite, Seiten und Dokumente.</p>
      </section>

      {bookingOnly ? (
        <section className="card stack" id="einbinden">
          <h2>Auf der eigenen Website einbinden</h2>
          <p className="small">Drei Möglichkeiten – von ganz einfach bis eingebaut. Alle führen zur Buchungsseite im Erscheinungsbild des Hotels.</p>

          <h3>Einfachste Lösung: bestehenden «Buchen»-Link ersetzen</h3>
          <p className="small muted">Funktioniert mit jedem Baukasten (Wix, Jimdo, WordPress, Webflow …): beim Knopf oder Menüpunkt «Buchen» diese Adresse eintragen.</p>
          <CopyBox text={link} label="Link zur Buchungsseite" />

          <h3>Knopf «Jetzt buchen»</h3>
          <p className="small muted">Diesen Code an der Stelle einfügen, wo der Knopf erscheinen soll (in WordPress z. B. mit einem «HTML»-Block). Eigener Text: <code>data-label=&quot;Zimmer buchen&quot;</code>. Andere Sprache: <code>data-lang=&quot;en&quot;</code> (oder fr, it, nl, wenn unten unter Sprachen gewählt).</p>
          <CopyBox text={button} label="Code für den Knopf" />
          <div className="card"><WidgetPreview src={scriptSrc} slug={hotel.slug} mode="button" /></div>

          <h3>Suchleiste mit Daten und Personen</h3>
          <p className="small muted">Der Gast wählt die Daten direkt auf Ihrer Website und sieht danach sofort die freien Zimmer.</p>
          <CopyBox text={search} label="Code für die Suchleiste" />
          <div className="card" style={{ background: "var(--accent-soft)" }}><WidgetPreview src={scriptSrc} slug={hotel.slug} mode="search" /></div>
          {hotel.status !== "live" ? <p className="notice warn small">Das Hotel ist noch nicht live – Gäste sehen auf der Buchungsseite einen Hinweis statt Angeboten.</p> : null}
        </section>
      ) : null}

      <section className="card stack" id="gestaltung">
        <h2>Gestaltung</h2>
        <p className="muted small">Layout und Schrift gelten für alle Seiten und die Buchungsstrecke. Hauptfarbe stellen Sie oben ein, das Logo weiter unten.</p>
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
          <fieldset className="plain mt12" disabled={!canEdit} >
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

      <section className="card stack" id="logo">
        <h2>Logo</h2>
        {brand.logoUrl ? <img src={brand.logoUrl} alt="Logo" style={{ maxHeight: 60, maxWidth: 240, objectFit: "contain", alignSelf: "flex-start" }} /> : <p className="muted small">Noch kein Logo – oben auf der Buchungsseite steht dann der Hotelname.</p>}
        {canEdit ? (
          <div className="inline-form">
            <form action={`/api/admin/hotels/${hotel.id}/photos`} method="post" encType="multipart/form-data" className="inline-form">
              <input type="hidden" name="target" value="logo" />
              <div><label htmlFor="f1c502">Logo hochladen (PNG mit transparentem Hintergrund, JPG oder WebP)</label><input id="f1c502" type="file" name="file" accept="image/png,image/jpeg,image/webp" required /></div>
              <button className="btn small">Hochladen</button>
            </form>
            {brand.logoUrl ? <form action={removeLogo}>{hidden}<button className="btn secondary small">Logo entfernen</button></form> : null}
          </div>
        ) : null}
        <p className="small"><a href={link} target="_blank">Buchungsseite ansehen</a></p>
      </section>

      <section className="card stack" id="hotel-photos">
        <h2>Fotos des Hotels</h2>
        <p className="muted small">Das erste Foto ist das Titelbild und erscheint gross auf der Startseite und der Buchungsseite. Fotos der einzelnen Zimmertypen verwalten Sie unter «Zimmer & Tarife».</p>
        <PhotoManager hotelId={hotel.id} roomTypeId={null} photos={hotel.content.photos ?? []} canEdit={canEdit} page="site" alt="z. B. Hotel mit Blick auf den See" />
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
            ? <>Texte übersetzen Sie im Editor jeder Seite mit «Fehlende Texte übersetzen», Zimmer & Tarife unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer</a>. Noch {translationsLeft(hotel)} automatische Übersetzungen diesen Monat.</>
            : <>Automatische Übersetzung ist noch nicht eingerichtet; die Felder können Sie im Editor von Hand ausfüllen.</>}
          {" "}AGB und Datenschutz erscheinen auf Französisch, Italienisch und Niederländisch vorerst auf Englisch.
        </p>
      </section>

      {!bookingOnly ? (
        <>
      <section className="card stack">
        <h2>Startseite</h2>
        {home ? (
          <p><a className="btn" href={`/admin/${hotel.id}/site/${home.id}`}>Startseite bearbeiten</a> <a href={`${base}/de`} target="_blank">ansehen</a></p>
        ) : canEdit ? (
          <>
            <form action={saveIntro} className="stack">
              {hidden}
              <p className="small muted m0">Einfache Startseite: Titel und Einleitung, darunter Ihre Zimmer.</p>
              <div className="form-grid">
                <div><label htmlFor="f1c503">Titel (DE)</label><input id="f1c503" name="headlineDe" defaultValue={hotel.content?.de?.headline ?? ""} /></div>
                <div><label htmlFor="f1c504">Titel (EN)</label><input id="f1c504" name="headlineEn" defaultValue={hotel.content?.en?.headline ?? ""} /></div>
                <div><label htmlFor="f1c505">Einleitung (DE)</label><textarea id="f1c505" name="introDe" rows={3} defaultValue={hotel.content?.de?.intro ?? ""} /></div>
                <div><label htmlFor="f1c506">Einleitung (EN)</label><textarea id="f1c506" name="introEn" rows={3} defaultValue={hotel.content?.en?.intro ?? ""} /></div>
              </div>
              <div><button className="btn">Speichern</button></div>
            </form>
            <form action={startHome} className="stack">
              {hidden}
              <p className="small muted m0">Mehr Freiheit: Mit dem Editor gestalten Sie die Startseite aus Bausteinen. Die bisherigen Texte werden übernommen.</p>
              <div><button className="btn secondary">Startseite gestalten</button></div>
            </form>
          </>
        ) : null}
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
            <div><label htmlFor="f1c507">PDF-Datei (max. 15 MB)</label><input id="f1c507" type="file" name="file" accept="application/pdf,.pdf" required /></div>
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
            <form action={newPage} className="inline-form">{hidden}<div><label htmlFor="f1c508">Neue Seite</label><input id="f1c508" name="title" placeholder="z. B. Restaurant" required /></div><button className="btn small">Anlegen</button></form>
            {!others.some((p) => p.slug === "impressum") ? <form action={newImprint}>{hidden}<button className="btn secondary small">Impressum anlegen</button></form> : null}
          </div>
        ) : null}
        <p className="muted small">Die Reihenfolge hier ist die Reihenfolge im Menü. AGB und Datenschutz gibt es automatisch.</p>
      </section>
        </>
      ) : null}
    </div>
  );
}
