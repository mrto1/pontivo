import { notFound, redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { addBlock, deleteBlock, documentLibrary, getPage, moveBlock, photoLibrary, SiteError, updateBlock, updatePageMeta } from "@/src/services/site";
import { RichTextarea } from "@/components/admin/RichTextarea";
import { publicBase } from "@/src/services/brand";
import { BLOCK_TYPES, type Block, type BlockType, type L } from "@/src/domain/blocks";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const raw = (f: FormData, k: string) => String(f.get(k) ?? "").replace(/\r\n/g, "\n").trim();
const l10n = (f: FormData, k: string): L => ({ de: raw(f, `${k}.de`) || undefined, en: raw(f, `${k}.en`) || undefined });

function errText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(", ");
  if (e instanceof SiteError) return e.message;
  throw e;
}

async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>, anchor = "") {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg: string;
  try {
    msg = await fn(c);
  } catch (e) {
    msg = `Nicht gespeichert: ${errText(e)}`;
  }
  // `at`: Vorschau springt zum zuletzt bearbeiteten Baustein
  const at = anchor.startsWith("#b-") ? `&at=${encodeURIComponent(anchor.slice(3))}` : "";
  redirect(`/admin/${c.hotel.id}/site/${s(f, "pageId")}?msg=${encodeURIComponent(msg)}${at}${anchor}`);
}

async function saveMeta(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await updatePageMeta(hotel.id, s(f, "pageId"), {
      title: l10n(f, "title"),
      navLabel: l10n(f, "nav"),
      slug: s(f, "slug"),
      showInNav: f.get("showInNav") === "on",
      published: f.get("published") === "on",
      seo: { de: { title: s(f, "seoTitle.de") || undefined, description: s(f, "seoDesc.de") || undefined }, en: { title: s(f, "seoTitle.en") || undefined, description: s(f, "seoDesc.en") || undefined } },
    }, actor);
    return "Seite gespeichert";
  });
}

const lookFrom = (f: FormData) => ({ align: s(f, "align") || "auto", size: s(f, "size") || "normal" });

/** Formularfelder eines Bausteins in Daten umwandeln */
function blockFromForm(f: FormData, type: BlockType, id: string, alts: Map<string, string | undefined>): unknown {
  const img = (k: string) => (s(f, k) ? { url: s(f, k), alt: alts.get(s(f, k)) } : null);
  switch (type) {
    case "hero": return { id, type, headline: l10n(f, "headline"), intro: l10n(f, "intro"), image: img("image"), showSearch: f.get("showSearch") === "on" };
    case "text": return { id, type, heading: l10n(f, "heading"), body: l10n(f, "body"), ...lookFrom(f) };
    case "image_text": return { id, type, heading: l10n(f, "heading"), body: l10n(f, "body"), image: img("image"), imageSide: s(f, "imageSide") === "right" ? "right" : "left", ...lookFrom(f) };
    case "gallery": return { id, type, heading: l10n(f, "heading"), images: f.getAll("images").map(String).map((u) => ({ url: u, alt: alts.get(u) })) };
    case "rooms": return { id, type, heading: l10n(f, "heading") };
    case "booking": return { id, type, heading: l10n(f, "heading") };
    case "facts": {
      const items = [];
      for (let i = 0; i < 20; i++) {
        const label = l10n(f, `label${i}`), value = l10n(f, `value${i}`);
        if (label.de || label.en || value.de || value.en) items.push({ label, value });
      }
      return { id, type, heading: l10n(f, "heading"), items };
    }
    case "location": return { id, type, heading: l10n(f, "heading"), address: s(f, "address"), body: l10n(f, "body"), ...lookFrom(f) };
    case "notice": return { id, type, body: l10n(f, "body"), ...lookFrom(f) };
    case "downloads": return { id, type, heading: l10n(f, "heading"), files: f.getAll("files").map(String) };
  }
}

async function saveBlock(f: FormData) {
  "use server";
  const blockId = s(f, "blockId");
  await run(f, async ({ hotel, actor }) => {
    const lib = await photoLibrary(hotel);
    const alts = new Map(lib.map((p) => [p.url, p.alt]));
    await updateBlock(hotel.id, s(f, "pageId"), blockId, blockFromForm(f, s(f, "type") as BlockType, blockId, alts), actor);
    return "Baustein gespeichert";
  }, `#b-${blockId}`);
}

async function blockAction(f: FormData) {
  "use server";
  const blockId = s(f, "blockId");
  const action = s(f, "action");
  await run(f, async ({ hotel, actor }) => {
    if (action === "up" || action === "down") await moveBlock(hotel.id, s(f, "pageId"), blockId, action === "up" ? -1 : 1, actor);
    else if (action === "delete") await deleteBlock(hotel.id, s(f, "pageId"), blockId, actor);
    return action === "delete" ? "Baustein entfernt" : "Verschoben";
  }, action === "delete" ? "" : `#b-${blockId}`);
}

async function newBlockAction(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let to = `/admin/${c.hotel.id}/site/${s(f, "pageId")}`;
  try {
    const id = await addBlock(c.hotel.id, s(f, "pageId"), s(f, "type") as BlockType, c.actor);
    to += `?msg=${encodeURIComponent("Baustein hinzugefügt – jetzt ausfüllen")}#b-${id}`;
  } catch (e) {
    to += `?msg=${encodeURIComponent(`Nicht möglich: ${errText(e)}`)}`;
  }
  redirect(to);
}

// ---------------------------------------------------------------- Formular-Bausteine

function LField({ name, label, value, rows, max }: { name: string; label: string; value?: L; rows?: number; max?: number }) {
  const Comp = (lang: "de" | "en") =>
    rows ? (
      <RichTextarea name={`${name}.${lang}`} rows={rows} defaultValue={value?.[lang] ?? ""} maxLength={max} label={`${label} ${lang.toUpperCase()}`} />
    ) : (
      <input name={`${name}.${lang}`} defaultValue={value?.[lang] ?? ""} maxLength={max} />
    );
  return (
    <div className="lfield">
      <div><label>{label} (DE)</label>{Comp("de")}</div>
      <div><label>{label} (EN)</label>{Comp("en")}</div>
    </div>
  );
}

type Lib = { url: string; alt?: string }[];

function ImagePick({ name, lib, value }: { name: string; lib: Lib; value?: string | null }) {
  return (
    <fieldset className="imgpick">
      <legend>Bild</legend>
      <label><input type="radio" name={name} value="" defaultChecked={!value} /><span className="noimg">kein Bild</span></label>
      {lib.map((p) => (
        <label key={p.url}><input type="radio" name={name} value={p.url} defaultChecked={value === p.url} /><img src={p.url} alt={p.alt ?? ""} /></label>
      ))}
    </fieldset>
  );
}

function GalleryPick({ lib, value }: { lib: Lib; value: string[] }) {
  return (
    <fieldset className="imgpick">
      <legend>Fotos auswählen</legend>
      {lib.map((p) => (
        <label key={p.url}><input type="checkbox" name="images" value={p.url} defaultChecked={value.includes(p.url)} /><img src={p.url} alt={p.alt ?? ""} /></label>
      ))}
    </fieldset>
  );
}

type Docs = ReturnType<typeof documentLibrary>;

function DocPick({ docs, value, hotelId }: { docs: Docs; value: string[]; hotelId: string }) {
  if (!docs.length) return <p className="notice warn small">Noch keine Dokumente. PDFs laden Sie unter <a href={`/admin/${hotelId}/site#dokumente`}>Website → Dokumente</a> hoch.</p>;
  return (
    <fieldset className="plain stack">
      <legend className="small muted">Dokumente auswählen (Reihenfolge wie in der Liste)</legend>
      {docs.map((d) => (
        <label key={d.url} className="check"><input type="checkbox" name="files" value={d.url} defaultChecked={value.includes(d.url)} />{d.title.de || d.title.en}</label>
      ))}
    </fieldset>
  );
}

/** Erweitert: Ausrichtung und Grösse – bewusst versteckt, Standard folgt dem Layout */
function Look({ b }: { b: { align: string; size: string } }) {
  return (
    <details className="look">
      <summary className="small">Erweitert: Ausrichtung und Textgrösse{b.align !== "auto" || b.size !== "normal" ? " (angepasst)" : ""}</summary>
      <p className="muted small">Nur wenn nötig. Das gewählte Layout ist auf gute Lesbarkeit abgestimmt, besonders auf dem Handy.</p>
      <div className="inline-form">
        <div><label>Ausrichtung</label><select name="align" defaultValue={b.align}><option value="auto">wie Layout (empfohlen)</option><option value="left">links</option><option value="center">zentriert</option></select></div>
        <div><label>Textgrösse</label><select name="size" defaultValue={b.size}><option value="normal">normal (empfohlen)</option><option value="large">gross</option></select></div>
      </div>
    </details>
  );
}

function BlockFields({ b, lib, docs, hotelId }: { b: Block; lib: Lib; docs: Docs; hotelId: string }) {
  switch (b.type) {
    case "hero":
      return (<>
        <LField name="headline" label="Überschrift" value={b.headline} max={200} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={3} max={1000} />
        <ImagePick name="image" lib={lib} value={b.image?.url} />
        <label className="check"><input type="checkbox" name="showSearch" defaultChecked={b.showSearch} />Suchleiste anzeigen</label>
      </>);
    case "text":
      return (<><LField name="heading" label="Überschrift" value={b.heading} max={200} /><LField name="body" label="Text" value={b.body} rows={6} /><Look b={b} /></>);
    case "image_text":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} />
        <LField name="body" label="Text" value={b.body} rows={5} />
        <ImagePick name="image" lib={lib} value={b.image?.url} />
        <div><label>Bild</label><select name="imageSide" defaultValue={b.imageSide}><option value="left">links</option><option value="right">rechts</option></select></div>
        <Look b={b} />
      </>);
    case "gallery":
      return (<><LField name="heading" label="Überschrift" value={b.heading} max={200} /><GalleryPick lib={lib} value={b.images.map((i) => i.url)} /></>);
    case "rooms":
    case "booking":
      return <LField name="heading" label="Überschrift" value={b.heading} max={200} />;
    case "facts": {
      const rowsN = Math.min(20, b.items.length + 3);
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} />
        <table className="table small">
          <thead><tr><th>Bezeichnung DE</th><th>Bezeichnung EN</th><th>Angabe DE</th><th>Angabe EN</th></tr></thead>
          <tbody>
            {Array.from({ length: rowsN }, (_, i) => (
              <tr key={i}>
                <td><input name={`label${i}.de`} defaultValue={b.items[i]?.label.de ?? ""} placeholder={i === 0 && !b.items.length ? "z. B. Mittag" : ""} /></td>
                <td><input name={`label${i}.en`} defaultValue={b.items[i]?.label.en ?? ""} /></td>
                <td><input name={`value${i}.de`} defaultValue={b.items[i]?.value.de ?? ""} placeholder={i === 0 && !b.items.length ? "11.30–14.00 Uhr" : ""} /></td>
                <td><input name={`value${i}.en`} defaultValue={b.items[i]?.value.en ?? ""} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Leere Zeilen werden ignoriert. Nach dem Speichern erscheinen drei neue leere Zeilen.</p>
      </>);
    }
    case "location":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} />
        <div><label>Adresse für die Route (leer = Hoteladresse)</label><input name="address" defaultValue={b.address} /></div>
        <LField name="body" label="Anreise-Text" value={b.body} rows={4} />
        <Look b={b} />
      </>);
    case "notice":
      return (<><LField name="body" label="Hinweis" value={b.body} rows={3} max={1000} /><Look b={b} /></>);
    case "downloads":
      return (<><LField name="heading" label="Überschrift" value={b.heading} max={200} /><DocPick docs={docs} value={b.files} hotelId={hotelId} /></>);
  }
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
  const isHome = page.slug === "";
  const preview = `/vorschau/${hotel.id}/${page.id}${sp.at ? `#b-${encodeURIComponent(sp.at)}` : ""}`;
  const url = `${publicBase(hotel)}/de${isHome ? "" : `/${page.slug}`}`;
  const ids = (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="pageId" value={page.id} /></>);
  const label = (t: BlockType) => BLOCK_TYPES.find((x) => x.type === t)?.label ?? t;

  return (
    <div className="editor-grid">
    <div className="stack editor-main">
      <a href={`/admin/${hotel.id}/site`}>← Website</a>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{isHome ? "Startseite" : page.title.de || page.title.en}</h1>
        <a href={url} target="_blank">Seite ansehen</a>
      </div>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      {!lib.length ? <p className="notice warn small">Noch keine Fotos in der Bibliothek. Fotos laden Sie unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer</a> hoch (Fotos des Hotels oder der Zimmer).</p> : null}

      <details className="card" open={!isHome && sp.msg === undefined}>
        <summary><strong>Seiten-Einstellungen</strong> <span className="muted small">Titel, Menü, Adresse, Google</span></summary>
        <form action={saveMeta} className="stack" style={{ marginTop: 12 }}>
          {ids}
          <LField name="title" label="Titel" value={page.title} max={120} />
          {!isHome ? (<>
            <LField name="nav" label="Name im Menü (leer = Titel)" value={page.navLabel} max={40} />
            <div><label>Adresse</label><input name="slug" defaultValue={page.slug} pattern="[a-z0-9-]+" /><p className="muted small">Nur Kleinbuchstaben, Ziffern und Bindestriche, z. B. «restaurant».</p></div>
            <label className="check"><input type="checkbox" name="showInNav" defaultChecked={page.showInNav} />Im Menü anzeigen</label>
            <label className="check"><input type="checkbox" name="published" defaultChecked={page.published} />Sichtbar (sonst Entwurf)</label>
          </>) : null}
          <div className="lfield">
            <div><label>Titel bei Google (DE, max. 70 Zeichen)</label><input name="seoTitle.de" maxLength={70} defaultValue={page.seo.de?.title ?? ""} /></div>
            <div><label>Titel bei Google (EN)</label><input name="seoTitle.en" maxLength={70} defaultValue={page.seo.en?.title ?? ""} /></div>
          </div>
          <div className="lfield">
            <div><label>Beschreibung bei Google (DE, max. 170 Zeichen)</label><textarea name="seoDesc.de" rows={2} maxLength={170} defaultValue={page.seo.de?.description ?? ""} /></div>
            <div><label>Beschreibung bei Google (EN)</label><textarea name="seoDesc.en" rows={2} maxLength={170} defaultValue={page.seo.en?.description ?? ""} /></div>
          </div>
          {canEdit ? <button className="btn small">Seite speichern</button> : null}
        </form>
      </details>

      {page.blocks.map((b, i) => (
        <section key={b.id} id={`b-${b.id}`} className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>{i + 1}. {label(b.type)}</h3>
            {canEdit ? (
              <div className="inline-form" style={{ gap: 4 }}>
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
              <div className="stack"><BlockFields b={b} lib={lib} docs={docs} hotelId={hotel.id} /></div>
            </fieldset>
            {canEdit ? <button className="btn small">Baustein speichern</button> : null}
          </form>
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
