import { Notice } from "@/components/admin/Notice";
import { notFound } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { documentLibrary, getPage, photoLibrary } from "@/src/services/site";
import { hotelLocales, isLocale, LOCALE_NAMES, LOCALES, type Locale } from "@/src/i18n/dict";
import { translationEnabled, translationsLeft } from "@/src/services/translate";
import { publicBase } from "@/src/services/brand";
import { BLOCK_TYPES, type Block, type BlockType, type L } from "@/src/domain/blocks";
import { listRooms } from "@/src/services/rooms";
import { BlockFields, LField, type Langs } from "./BlockFields";
import { blockAction, newBlockAction, saveBlock, saveMeta, translateAction } from "./actions";

export const dynamic = "force-dynamic";

function blockHasText(b: Block): boolean {
  const o = b as unknown as Record<string, L | undefined>;
  return ["headline", "intro", "heading", "body"].some((k) => !!o[k]?.de) || (b.type === "facts" && b.items.length > 0);
}

export default async function EditPage({ params, searchParams }: { params: Promise<{ hotelId: string; pageId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId, pageId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const page = await getPage(hotel.id, pageId);
  if (!page) notFound();
  const canEdit = atLeast(role, "manager");
  const lib = await photoLibrary(hotel);
  const docs = documentLibrary(hotel);
  const plans = (await listRooms(hotel.id)).flatMap(({ roomType, plans }) => plans.map((p) => ({ id: p.id, label: `${roomType.name} · ${p.name}${p.minNights > 1 ? ` (ab ${p.minNights} Nächten)` : ""}` })));
  const isHome = page.slug === "";
  const offered = hotelLocales(hotel);
  const extra: Locale[] = offered.filter((l) => l !== "de");
  const editLang: Locale | null = sp.lang && isLocale(sp.lang) && extra.includes(sp.lang) ? sp.lang : extra[0] ?? null;
  const langs: Langs = { edit: editLang, all: offered };
  const canTranslate = canEdit && translationEnabled() && extra.length > 0;
  const left = translationsLeft(hotel);
  const preview = `/vorschau/${hotel.id}/${page.id}${editLang && sp.pv === editLang ? `?lang=${editLang}` : ""}${sp.at ? `#b-${encodeURIComponent(sp.at)}` : ""}`;
  const langHref = (l: Locale) => `/admin/${hotel.id}/site/${page.id}?lang=${l}`;
  const url = `${publicBase(hotel)}/de${isHome ? "" : `/${page.slug}`}`;
  const ids = (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="pageId" value={page.id} />{editLang ? <input type="hidden" name="editLang" value={editLang} /> : null}</>);
  const label = (t: BlockType) => BLOCK_TYPES.find((x) => x.type === t)?.label ?? t;

  return (
    <div className="editor-grid">
    <div className="stack editor-main">
      <a href={`/admin/${hotel.id}/site`}>← Website</a>
      <div className="u-d-flex u-gap-12px u-ai-baseline u-fw-wrap">
        <h1 className="m0">{isHome ? "Startseite" : page.title.de || page.title.en}</h1>
        <a href={url} target="_blank">Seite ansehen</a>
      </div>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {extra.length ? (
        <div className="card lang-bar">
          <div className="lang-tabs" role="navigation" aria-label="Sprache bearbeiten">
            <span className="small muted">Bearbeiten: Deutsch und</span>
            {extra.map((l) => <a key={l} href={langHref(l)} className={l === editLang ? "active" : undefined} aria-current={l === editLang ? "true" : undefined}>{LOCALE_NAMES[l]}</a>)}
          </div>
          {canTranslate ? (
            <div className="inline-form gap6">
              <form action={translateAction}>{ids}<input type="hidden" name="mode" value="missing" /><button className="btn small" disabled={!left}>Fehlende Texte übersetzen</button></form>
              <form action={translateAction}>{ids}<input type="hidden" name="mode" value="all" /><button className="btn secondary small" disabled={!left} title="Überschreibt auch angepasste Übersetzungen">Alles neu übersetzen</button></form>
              <span className="small muted">aus dem Deutschen in alle Sprachen · noch {left} diesen Monat</span>
            </div>
          ) : extra.length && canEdit && !translationEnabled() ? <p className="small muted m0">Automatische Übersetzung ist noch nicht eingerichtet. Felder können Sie von Hand ausfüllen; leere Felder zeigen Englisch, dann Deutsch.</p> : null}
        </div>
      ) : (
        <p className="small muted">Die Website ist nur auf Deutsch. Weitere Sprachen wählen Sie unter <a href={`/admin/${hotel.id}/site#sprachen`}>Website → Sprachen</a>.</p>
      )}
      {!lib.length ? <p className="notice warn small">Noch keine Fotos in der Bibliothek. Fotos des Hotels laden Sie unter <a href={`/admin/${hotel.id}/site#hotel-photos`}>Website & Buchung</a> hoch, Zimmerfotos unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer und Tarife</a>.</p> : null}

      <details className="card" open={!isHome && sp.msg === undefined}>
        <summary><strong>Seiten-Einstellungen</strong> <span className="muted small">Titel, Menü, Adresse, Google</span></summary>
        <form action={saveMeta} className="stack mt12">
          {ids}
          <LField name="title" label="Titel" value={page.title} max={120} langs={langs} />
          {!isHome ? (<>
            <LField name="nav" label="Name im Menü (leer = Titel)" value={page.navLabel} max={40} langs={langs} />
            <div><label htmlFor="fff0826">Adresse</label><input id="fff0826" name="slug" defaultValue={page.slug} pattern="[a-z0-9-]+" /><p className="muted small">Nur Kleinbuchstaben, Ziffern und Bindestriche, z. B. «restaurant».</p></div>
            <label className="check"><input type="checkbox" name="showInNav" defaultChecked={page.showInNav} />Im Menü anzeigen</label>
            <label className="check"><input type="checkbox" name="published" defaultChecked={page.published} />Sichtbar (sonst Entwurf)</label>
          </>) : null}
          <div className="lfield">
            <div><label htmlFor="fff0827">Titel bei Google (DE, max. 70 Zeichen)</label><input id="fff0827" name="seoTitle.de" maxLength={70} defaultValue={page.seo.de?.title ?? ""} /></div>
            {editLang ? <div><label htmlFor={`pg-seoTitle.${editLang}`}>Titel bei Google ({editLang.toUpperCase()})</label><input id={`pg-seoTitle.${editLang}`} name={`seoTitle.${editLang}`} maxLength={70} defaultValue={page.seo[editLang]?.title ?? ""} /></div> : null}
          </div>
          <div className="lfield">
            <div><label htmlFor="fff0828">Beschreibung bei Google (DE, max. 170 Zeichen)</label><textarea id="fff0828" name="seoDesc.de" rows={2} maxLength={170} defaultValue={page.seo.de?.description ?? ""} /></div>
            {editLang ? <div><label htmlFor={`pg-seoDesc.${editLang}`}>Beschreibung bei Google ({editLang.toUpperCase()})</label><textarea id={`pg-seoDesc.${editLang}`} name={`seoDesc.${editLang}`} rows={2} maxLength={170} defaultValue={page.seo[editLang]?.description ?? ""} /></div> : null}
          </div>
          {LOCALES.filter((l) => l !== "de" && l !== editLang).map((l) => (
            <span key={l} hidden>
              {page.seo[l]?.title ? <input type="hidden" name={`seoTitle.${l}`} value={page.seo[l]!.title} /> : null}
              {page.seo[l]?.description ? <textarea name={`seoDesc.${l}`} defaultValue={page.seo[l]!.description} hidden readOnly /> : null}
            </span>
          ))}
          {canEdit ? <button className="btn small">Seite speichern</button> : null}
        </form>
      </details>

      {page.blocks.map((b, i) => (
        <section key={b.id} id={`b-${b.id}`} className="card stack">
          <div className="u-d-flex u-jc-space-between u-gap-12px u-ai-center u-fw-wrap">
            <h3 className="m0">{i + 1}. {label(b.type)}</h3>
            {canEdit ? (
              <div className="inline-form u-gap-4px">
                {(["up", "down", "delete"] as const).map((a) => (
                  <form key={a} action={blockAction}>{ids}<input type="hidden" name="blockId" value={b.id} /><input type="hidden" name="action" value={a} />
                    <button className="btn secondary small" disabled={(a === "up" && i === 0) || (a === "down" && i === page.blocks.length - 1)}>{a === "up" ? "↑ nach oben" : a === "down" ? "↓ nach unten" : "Entfernen"}</button>
                  </form>
                ))}
              </div>
            ) : null}
          </div>
          <form action={saveBlock} className="stack">
            {ids}
            <input type="hidden" name="blockId" value={b.id} />
            <input type="hidden" name="type" value={b.type} />
            <fieldset disabled={!canEdit} className="plain">
              <div className="stack"><BlockFields b={b} lib={lib} docs={docs} hotelId={hotel.id} langs={langs} plans={plans} hotelEmail={hotel.contactEmail} /></div>
            </fieldset>
            {canEdit ? <button className="btn small">Baustein speichern</button> : null}
          </form>
          {canTranslate && editLang && blockHasText(b) ? (
            <form action={translateAction} className="inline-form gap6">
              {ids}<input type="hidden" name="blockId" value={b.id} /><input type="hidden" name="mode" value="all" /><input type="hidden" name="onlyLang" value={editLang} />
              <button className="btn secondary small" disabled={!left}>Diesen Baustein auf {LOCALE_NAMES[editLang]} neu übersetzen</button>
              <span className="small muted">vorher speichern</span>
            </form>
          ) : null}
        </section>
      ))}
      {!page.blocks.length ? <p className="muted">Diese Seite ist noch leer.</p> : null}

      {canEdit ? (
        <section className="card stack">
          <h3>Baustein hinzufügen</h3>
          <div className="addblocks">
            {BLOCK_TYPES.map((t) => (
              <form key={t.type} action={newBlockAction}>
                {ids}
                <input type="hidden" name="type" value={t.type} />
                <button className="addblock"><strong>{t.label}</strong><span>{t.hint}</span></button>
              </form>
            ))}
          </div>
        </section>
      ) : null}
    </div>
    <aside className="editor-preview" aria-label="Vorschau">
      <div className="preview-bar">
        <strong>Vorschau</strong>
        <span className="muted small">aktualisiert sich beim Speichern</span>
        {editLang ? (
          <span className="preview-lang small">
            <a href={`/admin/${hotel.id}/site/${page.id}?lang=${editLang}`} aria-current={sp.pv !== editLang ? "true" : undefined}>DE</a>
            <a href={`/admin/${hotel.id}/site/${page.id}?lang=${editLang}&pv=${editLang}`} aria-current={sp.pv === editLang ? "true" : undefined}>{editLang.toUpperCase()}</a>
          </span>
        ) : null}
        <span className="preview-size">
          <label><input type="radio" name="pv-size" value="desktop" defaultChecked />Computer</label>
          <label><input type="radio" name="pv-size" value="mobile" />Handy</label>
        </span>
      </div>
      <div className="preview-frame"><iframe key={sp.msg ?? "start"} src={preview} title="Vorschau der Seite" /></div>
      <p className="muted small">Zeigt auch Entwürfe. Layout und Schrift ändern Sie unter <a href={`/admin/${hotel.id}/site#gestaltung`}>Website → Gestaltung</a>.</p>
    </aside>
    </div>
  );
}
