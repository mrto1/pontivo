import { notFound, redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { addBlock, deleteBlock, documentLibrary, getPage, moveBlock, photoLibrary, SiteError, updateBlock, updatePageMeta } from "@/src/services/site";
import { RichTextarea } from "@/components/admin/RichTextarea";
import { hotelLocales, isLocale, LOCALE_NAMES, LOCALES, type Locale } from "@/src/i18n/dict";
import { translatePage, translationEnabled, translationsLeft, TranslateError } from "@/src/services/translate";
import { publicBase } from "@/src/services/brand";
import { BLOCK_TYPES, INQUIRY_KINDS, TIP_CATEGORIES, type Block, type BlockType, type L } from "@/src/domain/blocks";
import { listRooms } from "@/src/services/rooms";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const raw = (f: FormData, k: string) => String(f.get(k) ?? "").replace(/\r\n/g, "\n").trim();
const l10n = (f: FormData, k: string): L => Object.fromEntries(LOCALES.map((l) => [l, raw(f, `${k}.${l}`) || undefined])) as L;

function errText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(", ");
  if (e instanceof SiteError || e instanceof TranslateError) return e.message;
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
  const lang = isLocale(s(f, "editLang")) ? `&lang=${s(f, "editLang")}` : "";
  redirect(`/admin/${c.hotel.id}/site/${s(f, "pageId")}?msg=${encodeURIComponent(msg)}${at}${lang}${anchor}`);
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
      seo: Object.fromEntries(LOCALES.map((l) => [l, { title: s(f, `seoTitle.${l}`) || undefined, description: s(f, `seoDesc.${l}`) || undefined }])) as never,
    }, actor);
    return "Seite gespeichert";
  });
}

/** Wiederholte Einträge (it0, it1, …) einlesen, leere weglassen */
function rows(f: FormData, read: (k: string) => unknown): unknown[] {
  const out: unknown[] = [];
  const keys = [...f.keys()];
  for (let i = 0; i < 40; i++) {
    const k = `it${i}`;
    if (!keys.some((x) => x.startsWith(`${k}.`))) continue;
    const v = read(k);
    if (v) out.push(v);
  }
  return out;
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
    case "location": {
      const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s(f, "coords"));
      return { id, type, heading: l10n(f, "heading"), address: s(f, "address"), body: l10n(f, "body"), ...lookFrom(f), lat: m ? Number(m[1]) : null, lng: m ? Number(m[2]) : null };
    }
    case "notice": return { id, type, body: l10n(f, "body"), ...lookFrom(f) };
    case "downloads": return { id, type, heading: l10n(f, "heading"), files: f.getAll("files").map(String) };
    case "reviews": return { id, type, heading: l10n(f, "heading"), moreUrl: s(f, "moreUrl") || null, items: rows(f, (k) => {
      const quote = l10n(f, `${k}.quote`);
      if (!Object.values(quote).some(Boolean)) return null;
      const r = Number(s(f, `${k}.rating`));
      return { quote, author: s(f, `${k}.author`), source: s(f, `${k}.source`), date: s(f, `${k}.date`), rating: r >= 1 && r <= 5 ? r : null, url: s(f, `${k}.url`) || null };
    }) };
    case "faq": return { id, type, heading: l10n(f, "heading"), items: rows(f, (k) => {
      const q = l10n(f, `${k}.q`), a = l10n(f, `${k}.a`);
      return Object.values(q).some(Boolean) ? { q, a } : null;
    }) };
    case "offers": return { id, type, heading: l10n(f, "heading"), items: rows(f, (k) => {
      const title = l10n(f, `${k}.title`);
      if (!Object.values(title).some(Boolean)) return null;
      return { title, text: l10n(f, `${k}.text`), price: l10n(f, `${k}.price`), image: img(`${k}.image`), ratePlanId: s(f, `${k}.plan`) || null, nights: Math.max(1, Number(s(f, `${k}.nights`)) || 1) };
    }) };
    case "tips": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro"), items: rows(f, (k) => {
      const title = l10n(f, `${k}.title`);
      if (!Object.values(title).some(Boolean)) return null;
      return { title, text: l10n(f, `${k}.text`), distance: l10n(f, `${k}.distance`), image: img(`${k}.image`), category: s(f, `${k}.category`) || "ausflug", season: s(f, `${k}.season`) || "all", url: s(f, `${k}.url`) || null };
    }) };
    case "inquiry": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro"), kinds: f.getAll("kinds").map(String) };
    case "voucher": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro") };
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

async function translateAction(f: FormData) {
  "use server";
  const blockId = s(f, "blockId") || undefined;
  await run(f, async ({ hotel, actor }) => {
    const only = { blockId, lang: isLocale(s(f, "onlyLang")) ? (s(f, "onlyLang") as Locale) : undefined };
    const n = await translatePage(hotel, s(f, "pageId"), s(f, "mode") === "all" ? "all" : "missing", actor, only);
    return n ? `${n} Feld(er) übersetzt – bitte kurz gegenlesen` : "Nichts zu übersetzen: alle Felder sind schon ausgefüllt";
  }, blockId ? `#b-${blockId}` : "");
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

/** Sprachen im Editor: Deutsch (Ausgangssprache) und die gewählte Zielsprache. Wird pro Anfrage gesetzt. */
type Langs = { edit: Locale | null; all: Locale[] };

function LField({ name, label, value, rows, max, langs }: { name: string; label: string; value?: L; rows?: number; max?: number; langs: Langs }) {
  const Comp = (lang: Locale) =>
    rows ? (
      <RichTextarea name={`${name}.${lang}`} rows={rows} defaultValue={value?.[lang] ?? ""} maxLength={max} label={`${label} ${lang.toUpperCase()}`} />
    ) : (
      <input name={`${name}.${lang}`} defaultValue={value?.[lang] ?? ""} maxLength={max} lang={lang} />
    );
  // Texte anderer Sprachen unverändert mitsenden, damit Speichern sie nicht löscht
  const hidden = LOCALES.filter((l) => l !== "de" && l !== langs.edit && value?.[l]);
  return (
    <div className="lfield">
      <div><label>{label} (DE)</label>{Comp("de")}</div>
      {langs.edit ? <div><label>{label} ({langs.edit.toUpperCase()}){!value?.[langs.edit] && value?.de ? <span className="badge warn" style={{ marginLeft: 6 }}>fehlt</span> : null}</label>{Comp(langs.edit)}</div> : null}
      {hidden.map((l) => <textarea key={l} name={`${name}.${l}`} defaultValue={value?.[l] ?? ""} hidden readOnly />)}
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

/** Wiederholte Einträge im Editor (it0, it1, …) */
function Items(n: number, render: (i: number, key: string) => React.ReactNode) {
  return Array.from({ length: Math.min(n, 40) }, (_, i) => (
    <fieldset key={i} className="item-group"><div className="stack">{render(i, `it${i}`)}</div></fieldset>
  ));
}
const TIP_LABEL: Record<string, string> = { wandern: "Wandern", ausflug: "Ausflug", kultur: "Kultur", essen: "Essen & Trinken", winter: "Winter", familie: "Familie", see: "See & Wasser" };
const KIND_LABEL: Record<string, string> = { group: "Gruppe", seminar: "Seminar / Tagung", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anderes" };

function BlockFields({ b, lib, docs, hotelId, langs, plans, hotelEmail }: { b: Block; lib: Lib; docs: Docs; hotelId: string; langs: Langs; plans: { id: string; label: string }[]; hotelEmail: string }) {
  switch (b.type) {
    case "hero":
      return (<>
        <LField name="headline" label="Überschrift" value={b.headline} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={3} max={1000} langs={langs} />
        <ImagePick name="image" lib={lib} value={b.image?.url} />
        <label className="check"><input type="checkbox" name="showSearch" defaultChecked={b.showSearch} />Suchleiste anzeigen</label>
      </>);
    case "text":
      return (<><LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} /><LField name="body" label="Text" value={b.body} rows={6} langs={langs} /><Look b={b} /></>);
    case "image_text":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="body" label="Text" value={b.body} rows={5} langs={langs} />
        <ImagePick name="image" lib={lib} value={b.image?.url} />
        <div><label>Bild</label><select name="imageSide" defaultValue={b.imageSide}><option value="left">links</option><option value="right">rechts</option></select></div>
        <Look b={b} />
      </>);
    case "gallery":
      return (<><LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} /><GalleryPick lib={lib} value={b.images.map((i) => i.url)} /></>);
    case "rooms":
    case "booking":
      return <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />;
    case "facts": {
      const rowsN = Math.min(20, b.items.length + 3);
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <table className="table small">
          <thead><tr><th>Bezeichnung DE</th>{langs.edit ? <th>Bezeichnung {langs.edit.toUpperCase()}</th> : null}<th>Angabe DE</th>{langs.edit ? <th>Angabe {langs.edit.toUpperCase()}</th> : null}</tr></thead>
          <tbody>
            {Array.from({ length: rowsN }, (_, i) => (
              <tr key={i}>
                <td><input name={`label${i}.de`} defaultValue={b.items[i]?.label.de ?? ""} placeholder={i === 0 && !b.items.length ? "z. B. Mittag" : ""} /></td>
                {langs.edit ? <td><input name={`label${i}.${langs.edit}`} defaultValue={b.items[i]?.label[langs.edit] ?? ""} /></td> : null}
                <td><input name={`value${i}.de`} defaultValue={b.items[i]?.value.de ?? ""} placeholder={i === 0 && !b.items.length ? "11.30–14.00 Uhr" : ""} /></td>
                {langs.edit ? <td><input name={`value${i}.${langs.edit}`} defaultValue={b.items[i]?.value[langs.edit] ?? ""} /></td> : null}
                {LOCALES.filter((l) => l !== "de" && l !== langs.edit).map((l) => (
                  <td key={l} hidden>
                    {b.items[i]?.label[l] ? <input type="hidden" name={`label${i}.${l}`} value={b.items[i]!.label[l]} /> : null}
                    {b.items[i]?.value[l] ? <input type="hidden" name={`value${i}.${l}`} value={b.items[i]!.value[l]} /> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Leere Zeilen werden ignoriert. Nach dem Speichern erscheinen drei neue leere Zeilen.</p>
      </>);
    }
    case "location":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <div><label>Adresse für die Route (leer = Hoteladresse)</label><input name="address" defaultValue={b.address} /></div>
        <LField name="body" label="Anreise-Text" value={b.body} rows={4} langs={langs} />
        <div><label>Koordinaten für die Karte (optional, z. B. 47.0405, 9.0679)</label><input name="coords" defaultValue={b.lat !== null && b.lng !== null ? `${b.lat}, ${b.lng}` : ""} placeholder="Breite, Länge" />
          <p className="muted small">In Google Maps: Rechtsklick auf das Hotel → die Zahlen oben anklicken (kopiert sie). Die Karte (OpenStreetMap) lädt für Gäste erst nach einem Klick.</p></div>
        <Look b={b} />
      </>);
    case "notice":
      return (<><LField name="body" label="Hinweis" value={b.body} rows={3} max={1000} langs={langs} /><Look b={b} /></>);
    case "downloads":
      return (<><LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} /><DocPick docs={docs} value={b.files} hotelId={hotelId} /></>);
    case "reviews":
      return (<>
        <p className="notice small">Nur <strong>echte Bewertungen</strong> verwenden – mit Name (oder Vorname und Initial) und Quelle, z. B. Google, Booking.com, Gästebuch. Erfundene oder veränderte Bewertungen sind unlauter (UWG) und schaden dem Vertrauen.</p>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        {Items(b.items.length + 2, (i, k) => {
          const it = b.items[i];
          return (<>
            <LField name={`${k}.quote`} label={`Bewertung ${i + 1}`} value={it?.quote} rows={3} max={800} langs={langs} />
            <div className="form-grid">
              <div><label>Name</label><input name={`${k}.author`} defaultValue={it?.author ?? ""} placeholder="z. B. Sandra M." maxLength={80} /></div>
              <div><label>Quelle</label><input name={`${k}.source`} defaultValue={it?.source ?? ""} placeholder="z. B. Google" list="review-sources" maxLength={60} /></div>
              <div><label>Monat</label><input name={`${k}.date`} type="month" defaultValue={it?.date ?? ""} /></div>
              <div><label>Sterne</label><select name={`${k}.rating`} defaultValue={it?.rating ?? ""}><option value="">–</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label>Link zur Bewertung (optional)</label><input name={`${k}.url`} defaultValue={it?.url ?? ""} placeholder="https://…" /></div>
            </div>
          </>);
        })}
        <datalist id="review-sources"><option value="Google" /><option value="Booking.com" /><option value="Tripadvisor" /><option value="Gästebuch" /><option value="E-Mail" /></datalist>
        <div><label>Link «Alle Bewertungen ansehen» (z. B. Google)</label><input name="moreUrl" defaultValue={b.moreUrl ?? ""} placeholder="https://g.page/…" /></div>
      </>);
    case "faq":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <p className="muted small">Typisch: Parkplatz, Haustiere, Check-in spät, Frühstückszeiten, Anreise mit ÖV, Kinderbetten, Barrierefreiheit.</p>
        {Items(b.items.length + 3, (i, k) => (<>
          <LField name={`${k}.q`} label={`Frage ${i + 1}`} value={b.items[i]?.q} max={300} langs={langs} />
          <LField name={`${k}.a`} label="Antwort" value={b.items[i]?.a} rows={3} max={2000} langs={langs} />
        </>))}
      </>);
    case "offers":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <p className="muted small">Ein Angebot verweist auf einen <a href={`/admin/${hotelId}/rooms`}>Tarif</a>, z. B. «3 Nächte mit Halbpension» mit Mindestaufenthalt 3 Nächte. Der Knopf «Angebot buchen» zeigt dann nur diesen Tarif.</p>
        {Items(b.items.length + 1, (i, k) => {
          const it = b.items[i];
          return (<>
            <LField name={`${k}.title`} label={`Angebot ${i + 1}`} value={it?.title} max={120} langs={langs} />
            <LField name={`${k}.text`} label="Beschreibung" value={it?.text} rows={3} max={1000} langs={langs} />
            <LField name={`${k}.price`} label="Preis-Hinweis (optional)" value={it?.price} max={80} langs={langs} />
            <div className="form-grid">
              <div><label>Tarif</label><select name={`${k}.plan`} defaultValue={it?.ratePlanId ?? ""}><option value="">alle Tarife</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
              <div><label>Nächte vorschlagen</label><input name={`${k}.nights`} type="number" min={1} max={60} defaultValue={it?.nights ?? 2} /></div>
            </div>
            <ImagePick name={`${k}.image`} lib={lib} value={it?.image?.url} />
          </>);
        })}
      </>);
    case "tips":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={2} max={1000} langs={langs} />
        <p className="muted small">Die Tipps nutzt später auch der KI-Chat, um Gästen Ausflüge zu empfehlen. Je genauer (Dauer, Saison, für wen), desto besser.</p>
        {Items(b.items.length + 2, (i, k) => {
          const it = b.items[i];
          return (<>
            <LField name={`${k}.title`} label={`Tipp ${i + 1}`} value={it?.title} max={120} langs={langs} />
            <LField name={`${k}.text`} label="Beschreibung" value={it?.text} rows={3} max={1000} langs={langs} />
            <LField name={`${k}.distance`} label="Entfernung / Dauer" value={it?.distance} max={80} langs={langs} />
            <div className="form-grid">
              <div><label>Kategorie</label><select name={`${k}.category`} defaultValue={it?.category ?? "ausflug"}>{TIP_CATEGORIES.map((c) => <option key={c} value={c}>{TIP_LABEL[c]}</option>)}</select></div>
              <div><label>Saison</label><select name={`${k}.season`} defaultValue={it?.season ?? "all"}><option value="all">ganzjährig</option><option value="summer">Sommer</option><option value="winter">Winter</option></select></div>
              <div><label>Link (optional)</label><input name={`${k}.url`} defaultValue={it?.url ?? ""} placeholder="https://…" /></div>
            </div>
            <ImagePick name={`${k}.image`} lib={lib} value={it?.image?.url} />
          </>);
        })}
      </>);
    case "inquiry":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={2} max={1000} langs={langs} />
        <fieldset className="plain"><legend className="small muted">Anlässe zur Auswahl</legend>
          <div className="weekdays">{INQUIRY_KINDS.map((k) => <label key={k}><input type="checkbox" name="kinds" value={k} defaultChecked={b.kinds.includes(k)} />{KIND_LABEL[k]}</label>)}</div>
        </fieldset>
        <p className="muted small">Anfragen kommen per E-Mail an {hotelEmail} und stehen unter <a href={`/admin/${hotelId}/inquiries`}>Anfragen</a>.</p>
      </>);
    case "voucher":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={2} max={1000} langs={langs} />
        <p className="muted small">Beträge, Gültigkeit und Ein/Aus stellen Sie unter <a href={`/admin/${hotelId}/vouchers`}>Gutscheine</a> ein.</p>
      </>);
  }
}

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
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{isHome ? "Startseite" : page.title.de || page.title.en}</h1>
        <a href={url} target="_blank">Seite ansehen</a>
      </div>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      {extra.length ? (
        <div className="card lang-bar">
          <div className="lang-tabs" role="navigation" aria-label="Sprache bearbeiten">
            <span className="small muted">Bearbeiten: Deutsch und</span>
            {extra.map((l) => <a key={l} href={langHref(l)} className={l === editLang ? "active" : undefined} aria-current={l === editLang ? "true" : undefined}>{LOCALE_NAMES[l]}</a>)}
          </div>
          {canTranslate ? (
            <div className="inline-form" style={{ gap: 6 }}>
              <form action={translateAction}>{ids}<input type="hidden" name="mode" value="missing" /><button className="btn small" disabled={!left}>Fehlende Texte übersetzen</button></form>
              <form action={translateAction}>{ids}<input type="hidden" name="mode" value="all" /><button className="btn secondary small" disabled={!left} title="Überschreibt auch angepasste Übersetzungen">Alles neu übersetzen</button></form>
              <span className="small muted">aus dem Deutschen in alle Sprachen · noch {left} diesen Monat</span>
            </div>
          ) : extra.length && canEdit && !translationEnabled() ? <p className="small muted" style={{ margin: 0 }}>Automatische Übersetzung ist noch nicht eingerichtet. Felder können Sie von Hand ausfüllen; leere Felder zeigen Englisch, dann Deutsch.</p> : null}
        </div>
      ) : (
        <p className="small muted">Die Website ist nur auf Deutsch. Weitere Sprachen wählen Sie unter <a href={`/admin/${hotel.id}/site#sprachen`}>Website → Sprachen</a>.</p>
      )}
      {!lib.length ? <p className="notice warn small">Noch keine Fotos in der Bibliothek. Fotos laden Sie unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer</a> hoch (Fotos des Hotels oder der Zimmer).</p> : null}

      <details className="card" open={!isHome && sp.msg === undefined}>
        <summary><strong>Seiten-Einstellungen</strong> <span className="muted small">Titel, Menü, Adresse, Google</span></summary>
        <form action={saveMeta} className="stack" style={{ marginTop: 12 }}>
          {ids}
          <LField name="title" label="Titel" value={page.title} max={120} langs={langs} />
          {!isHome ? (<>
            <LField name="nav" label="Name im Menü (leer = Titel)" value={page.navLabel} max={40} langs={langs} />
            <div><label>Adresse</label><input name="slug" defaultValue={page.slug} pattern="[a-z0-9-]+" /><p className="muted small">Nur Kleinbuchstaben, Ziffern und Bindestriche, z. B. «restaurant».</p></div>
            <label className="check"><input type="checkbox" name="showInNav" defaultChecked={page.showInNav} />Im Menü anzeigen</label>
            <label className="check"><input type="checkbox" name="published" defaultChecked={page.published} />Sichtbar (sonst Entwurf)</label>
          </>) : null}
          <div className="lfield">
            <div><label>Titel bei Google (DE, max. 70 Zeichen)</label><input name="seoTitle.de" maxLength={70} defaultValue={page.seo.de?.title ?? ""} /></div>
            {editLang ? <div><label>Titel bei Google ({editLang.toUpperCase()})</label><input name={`seoTitle.${editLang}`} maxLength={70} defaultValue={page.seo[editLang]?.title ?? ""} /></div> : null}
          </div>
          <div className="lfield">
            <div><label>Beschreibung bei Google (DE, max. 170 Zeichen)</label><textarea name="seoDesc.de" rows={2} maxLength={170} defaultValue={page.seo.de?.description ?? ""} /></div>
            {editLang ? <div><label>Beschreibung bei Google ({editLang.toUpperCase()})</label><textarea name={`seoDesc.${editLang}`} rows={2} maxLength={170} defaultValue={page.seo[editLang]?.description ?? ""} /></div> : null}
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
              <div className="stack"><BlockFields b={b} lib={lib} docs={docs} hotelId={hotel.id} langs={langs} plans={plans} hotelEmail={hotel.contactEmail} /></div>
            </fieldset>
            {canEdit ? <button className="btn small">Baustein speichern</button> : null}
          </form>
          {canTranslate && editLang && blockHasText(b) ? (
            <form action={translateAction} className="inline-form" style={{ gap: 6 }}>
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
