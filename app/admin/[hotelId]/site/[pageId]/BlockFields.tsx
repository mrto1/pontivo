import { RichTextarea } from "@/components/admin/RichTextarea";
import { LOCALES, type Locale } from "@/src/i18n/dict";
import { HOURS_PLACES, INQUIRY_KINDS, TIP_CATEGORIES, type Block, type L } from "@/src/domain/blocks";
import type { documentLibrary } from "@/src/services/site";

/** Eingabefelder der Website-Bausteine im Editor (Daten → Formular; zurück: src/domain/block-form.ts) */

/** Sprachen im Editor: Deutsch (Ausgangssprache) und die gewählte Zielsprache. Wird pro Anfrage gesetzt. */
export type Langs = { edit: Locale | null; all: Locale[] };

export function LField({ name, label, value, rows, max, langs }: { name: string; label: string; value?: L; rows?: number; max?: number; langs: Langs }) {
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
      {langs.edit ? <div><label>{label} ({langs.edit.toUpperCase()}){!value?.[langs.edit] && value?.de ? <span className="badge warn u-ml-6px">fehlt</span> : null}</label>{Comp(langs.edit)}</div> : null}
      {hidden.map((l) => <textarea key={l} name={`${name}.${l}`} defaultValue={value?.[l] ?? ""} hidden readOnly />)}
    </div>
  );
}

export type Lib = { url: string; alt?: string }[];

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

export type Docs = ReturnType<typeof documentLibrary>;

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
function Look({ b }: { b: { id: string; align: string; size: string } }) {
  const fid = (name: string) => `f-${b.id}-${name}`;
  return (
    <details className="look">
      <summary className="small">Erweitert: Ausrichtung und Textgrösse{b.align !== "auto" || b.size !== "normal" ? " (angepasst)" : ""}</summary>
      <p className="muted small">Nur wenn nötig. Das gewählte Layout ist auf gute Lesbarkeit abgestimmt, besonders auf dem Handy.</p>
      <div className="inline-form">
        <div><label htmlFor={fid(`align`)}>Ausrichtung</label><select id={fid(`align`)} name="align" defaultValue={b.align}><option value="auto">wie Layout (empfohlen)</option><option value="left">links</option><option value="center">zentriert</option></select></div>
        <div><label htmlFor={fid(`size`)}>Textgrösse</label><select id={fid(`size`)} name="size" defaultValue={b.size}><option value="normal">normal (empfohlen)</option><option value="large">gross</option></select></div>
      </div>
    </details>
  );
}

/** Wiederholte Einträge im Editor (it0, it1, …) */
function Items(n: number, render: (i: number, key: string) => React.ReactNode) {
  return Array.from({ length: Math.min(n, 80) }, (_, i) => (
    <fieldset key={i} className="item-group"><div className="stack">{render(i, `it${i}`)}</div></fieldset>
  ));
}
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const PLACE_LABEL: Record<string, string> = { restaurant: "Restaurant (für Google als Restaurant-Öffnungszeiten)", reception: "Rezeption", other: "Anderes (Bar, Spa, Laden …)" };
const chf = (r: number | null | undefined) => (r == null ? "" : (r / 100).toFixed(2));

const TIP_LABEL: Record<string, string> = { wandern: "Wandern", ausflug: "Ausflug", kultur: "Kultur", essen: "Essen & Trinken", winter: "Winter", familie: "Familie", see: "See & Wasser" };
const KIND_LABEL: Record<string, string> = { table: "Tisch reservieren", group: "Gruppe", seminar: "Seminar / Tagung", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anderes" };

export function BlockFields({ b, lib, docs, hotelId, langs, plans, hotelEmail }: { b: Block; lib: Lib; docs: Docs; hotelId: string; langs: Langs; plans: { id: string; label: string }[]; hotelEmail: string }) {
  /** Eindeutige Feld-IDs je Baustein (mehrere Bausteine und Einträge auf einer Seite) */
  const fid = (name: string) => `f-${b.id}-${name}`;
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
        <div><label htmlFor={fid(`imageSide`)}>Bild</label><select id={fid(`imageSide`)} name="imageSide" defaultValue={b.imageSide}><option value="left">links</option><option value="right">rechts</option></select></div>
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
        <div><label htmlFor={fid(`address`)}>Adresse für die Route (leer = Hoteladresse)</label><input id={fid(`address`)} name="address" defaultValue={b.address} /></div>
        <LField name="body" label="Anreise-Text" value={b.body} rows={4} langs={langs} />
        <div><label htmlFor={fid(`coords`)}>Koordinaten für die Karte (optional, z. B. 47.0405, 9.0679)</label><input id={fid(`coords`)} name="coords" defaultValue={b.lat !== null && b.lng !== null ? `${b.lat}, ${b.lng}` : ""} placeholder="Breite, Länge" />
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
              <div><label htmlFor={fid(`${k}.author`)}>Name</label><input id={fid(`${k}.author`)} name={`${k}.author`} defaultValue={it?.author ?? ""} placeholder="z. B. Sandra M." maxLength={80} /></div>
              <div><label htmlFor={fid(`${k}.source`)}>Quelle</label><input id={fid(`${k}.source`)} name={`${k}.source`} defaultValue={it?.source ?? ""} placeholder="z. B. Google" list="review-sources" maxLength={60} /></div>
              <div><label htmlFor={fid(`${k}.date`)}>Monat</label><input id={fid(`${k}.date`)} name={`${k}.date`} type="month" defaultValue={it?.date ?? ""} /></div>
              <div><label htmlFor={fid(`${k}.rating`)}>Sterne</label><select id={fid(`${k}.rating`)} name={`${k}.rating`} defaultValue={it?.rating ?? ""}><option value="">–</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label htmlFor={fid(`${k}.url`)}>Link zur Bewertung (optional)</label><input id={fid(`${k}.url`)} name={`${k}.url`} defaultValue={it?.url ?? ""} placeholder="https://…" /></div>
            </div>
          </>);
        })}
        <datalist id="review-sources"><option value="Google" /><option value="Booking.com" /><option value="Tripadvisor" /><option value="Gästebuch" /><option value="E-Mail" /></datalist>
        <div><label htmlFor={fid(`moreUrl`)}>Link «Alle Bewertungen ansehen» (z. B. Google)</label><input id={fid(`moreUrl`)} name="moreUrl" defaultValue={b.moreUrl ?? ""} placeholder="https://g.page/…" /></div>
      </>);
    case "labels":
      return (<>
        <p className="notice small">Nur Auszeichnungen zeigen, die Ihr Betrieb <strong>tatsächlich führt</strong> (z. B. Swisstainable mit der richtigen Stufe). Irreführende Labels sind unlauter (UWG). Logo am besten aus den Unterlagen des Labels in die Foto-Bibliothek laden und beim Label verlinken (Nutzungsregeln des Labels beachten).</p>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        {Items(b.items.length + 2, (i, k) => {
          const it = b.items[i];
          return (<>
            <div className="form-grid">
              <div><label htmlFor={`pg-${k}.name`}>Name des Labels {i + 1}</label><input id={`pg-${k}.name`} name={`${k}.name`} defaultValue={it?.name ?? ""} placeholder="z. B. Swisstainable" maxLength={80} /></div>
              <div><label htmlFor={fid(`${k}.url`)}>Link (optional)</label><input id={fid(`${k}.url`)} name={`${k}.url`} defaultValue={it?.url ?? ""} placeholder="https://…" /></div>
            </div>
            <LField name={`${k}.level`} label="Stufe (optional, z. B. «Level II – engaged»)" value={it?.level} max={60} langs={langs} />
            <LField name={`${k}.text`} label="Kurztext (optional)" value={it?.text} rows={2} max={400} langs={langs} />
            <ImagePick name={`${k}.image`} lib={lib} value={it?.image?.url} />
          </>);
        })}
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
            <LField name={`${k}.includes`} label="Inklusive (eine Leistung pro Zeile, optional)" value={it?.includes} rows={3} max={800} langs={langs} />
            <LField name={`${k}.price`} label="Preis-Hinweis (optional)" value={it?.price} max={80} langs={langs} />
            <div className="form-grid">
              <div><label htmlFor={fid(`${k}.validFrom`)}>gültig von (optional)</label><input id={fid(`${k}.validFrom`)} name={`${k}.validFrom`} type="date" defaultValue={it?.validFrom ?? ""} /></div>
              <div><label htmlFor={fid(`${k}.validTo`)}>gültig bis (optional)</label><input id={fid(`${k}.validTo`)} name={`${k}.validTo`} type="date" defaultValue={it?.validTo ?? ""} /></div>
              <div><label htmlFor={fid(`${k}.plan`)}>Tarif</label><select id={fid(`${k}.plan`)} name={`${k}.plan`} defaultValue={it?.ratePlanId ?? ""}><option value="">alle Tarife</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
              <div><label htmlFor={fid(`${k}.nights`)}>Nächte vorschlagen</label><input id={fid(`${k}.nights`)} name={`${k}.nights`} type="number" min={1} max={60} defaultValue={it?.nights ?? 2} /></div>
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
              <div><label htmlFor={fid(`${k}.category`)}>Kategorie</label><select id={fid(`${k}.category`)} name={`${k}.category`} defaultValue={it?.category ?? "ausflug"}>{TIP_CATEGORIES.map((c) => <option key={c} value={c}>{TIP_LABEL[c]}</option>)}</select></div>
              <div><label htmlFor={fid(`${k}.season`)}>Saison</label><select id={fid(`${k}.season`)} name={`${k}.season`} defaultValue={it?.season ?? "all"}><option value="all">ganzjährig</option><option value="summer">Sommer</option><option value="winter">Winter</option></select></div>
              <div><label htmlFor={fid(`${k}.url`)}>Link (optional)</label><input id={fid(`${k}.url`)} name={`${k}.url`} defaultValue={it?.url ?? ""} placeholder="https://…" /></div>
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
        <p className="muted small">Anfragen kommen per E-Mail an {hotelEmail} und stehen unter <a href={`/admin/${hotelId}/inbox?quelle=web`}>Anfragen</a>.</p>
      </>);
    case "menu":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung (optional)" value={b.intro} rows={2} max={1000} langs={langs} />
        <div><label htmlFor={fid(`source`)}>Gerichte</label><select id={fid(`source`)} name="source" defaultValue={b.source} data-testid="menu-source">
          <option value="items">Aus der Speisekarte (wie Online-Bestellung und Kasse)</option>
          <option value="manual">Hier von Hand erfassen</option>
        </select></div>
        {b.source === "items" ? <p className="muted small">Die Gerichte kommen aus <a href={`/admin/${hotelId}/restaurant/artikel`}>Speisekarte</a> (Rubrik, Name, Beschreibung, Preis, Allergene). Änderungen dort erscheinen sofort auf der Website. Zum Erfassen von Hand oben umstellen und speichern.</p> : <p className="muted small">Gerichte mit gleicher Rubrik hintereinander erscheinen als ein Abschnitt (z. B. «Vorspeisen», «Hauptgänge»). Preis wie 28.50 oder leer lassen. Nach dem Speichern erscheinen drei neue leere Zeilen.</p>}
        <div hidden={b.source === "items"}>{Items(b.items.length + 3, (i, k) => {
          const it = b.items[i];
          const prevSection = it?.section ?? b.items[b.items.length - 1]?.section;
          return (<>
            <div className="form-grid">
              <LField name={`${k}.section`} label="Rubrik" value={prevSection} max={80} langs={langs} />
              <div><label htmlFor={fid(`${k}.price`)}>Preis CHF</label><input className="u-maxw-140px" id={fid(`${k}.price`)} name={`${k}.price`} defaultValue={chf(it?.priceRappen)} inputMode="decimal" placeholder="28.50" /></div>
            </div>
            <LField name={`${k}.name`} label={`Gericht ${i + 1}`} value={it?.name} max={160} langs={langs} />
            <LField name={`${k}.text`} label="Beschreibung (optional)" value={it?.text} max={500} langs={langs} />
            <div className="weekdays">
              <label><input type="radio" name={`${k}.diet`} value="" defaultChecked={!it?.diet} />–</label>
              <label><input type="radio" name={`${k}.diet`} value="vegetarian" defaultChecked={it?.diet === "vegetarian"} />vegetarisch</label>
              <label><input type="radio" name={`${k}.diet`} value="vegan" defaultChecked={it?.diet === "vegan"} />vegan</label>
              <label><input type="checkbox" name={`${k}.gf`} defaultChecked={it?.glutenFree} />glutenfrei</label>
            </div>
          </>);
        })}</div>
        <LField name="note" label="Hinweise unter der Karte" value={b.note} rows={3} max={1000} langs={langs} />
        <p className="muted small">In der Schweiz muss die <strong>Herkunft von Fleisch und Fisch</strong> schriftlich angegeben werden, z. B. «Rind: Schweiz, Lachs: Norwegen (Zucht)». Zu Allergenen genügt der Hinweis «Auskunft über Allergene gibt Ihnen gerne unser Personal». Bitte im Zweifel beim kantonalen Lebensmittelinspektorat nachfragen.</p>
      </>);
    case "hours":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <div><label htmlFor={fid(`place`)}>Öffnungszeiten von</label><select id={fid(`place`)} name="place" defaultValue={b.place}>{HOURS_PLACES.map((p) => <option key={p} value={p}>{PLACE_LABEL[p]}</option>)}</select></div>
        <div><label htmlFor={fid(`source`)}>Zeiten</label><select id={fid(`source`)} name="source" defaultValue={b.source}>
          <option value="opening">Aus den Öffnungszeiten der Betriebsdaten (wie Reservation und Online-Bestellung)</option>
          <option value="manual">Hier von Hand erfassen</option>
        </select></div>
        {b.source === "opening" ? <p className="muted small">Die Zeiten kommen aus <a href={`/admin/${hotelId}/settings#gastronomie`}>Betriebsdaten → Öffnungszeiten</a>. Betriebsferien und Hinweis erfassen Sie hier.</p> : null}
        <table className="table small" hidden={b.source === "opening"}>
          <thead><tr><th>Tag</th><th>1. Zeitfenster</th><th>2. Zeitfenster</th><th>3. Zeitfenster</th></tr></thead>
          <tbody>
            {WEEKDAYS.map((w, i) => (
              <tr key={w}>
                <td>{w}</td>
                {[0, 1, 2].map((j) => (
                  <td className="nowrap" key={j}>
                    <input className="w110" type="time" name={`d${i}.${j}.from`} defaultValue={b.days[i]?.[j]?.from ?? ""} step={900} aria-label={`${w} ${j + 1}. von`} /> –{" "}
                    <input className="w110" type="time" name={`d${i}.${j}.to`} defaultValue={b.days[i]?.[j]?.to ?? ""} step={900} aria-label={`${w} ${j + 1}. bis`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Tag ohne Zeiten = geschlossen (Ruhetag). Gleiche Tage hintereinander werden zusammengefasst, z. B. «Mo–Fr». Bis nach Mitternacht: z. B. 18:00 – 00:30.</p>
        <fieldset className="plain"><legend className="small muted">Betriebsferien (vergangene werden automatisch ausgeblendet)</legend>
          {Array.from({ length: Math.min(10, b.closures.length + 2) }, (_, i) => (
            <div key={i} className="form-grid">
              <div><label htmlFor={fid(`c${i}.from`)}>von</label><input id={fid(`c${i}.from`)} type="date" name={`c${i}.from`} defaultValue={b.closures[i]?.from ?? ""} /></div>
              <div><label htmlFor={fid(`c${i}.to`)}>bis</label><input id={fid(`c${i}.to`)} type="date" name={`c${i}.to`} defaultValue={b.closures[i]?.to ?? ""} /></div>
              <LField name={`c${i}.label`} label="Bemerkung (optional)" value={b.closures[i]?.label} max={120} langs={langs} />
            </div>
          ))}
        </fieldset>
        <LField name="note" label="Hinweis (optional)" value={b.note} rows={2} max={1000} langs={langs} />
      </>);
    case "reserve":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={2} max={1000} langs={langs} />
        <p className="muted small">Zeiten, Plätze und Ein/Aus stellen Sie unter <a href={`/admin/${hotelId}/restaurant/einstellungen#online`}>Reservation</a> ein. Ist die Online-Reservation aus, bleibt der Baustein unsichtbar.</p>
      </>);
    case "order":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={2} max={1000} langs={langs} />
        <p className="muted small">Abholung, Lieferung und Ein/Aus stellen Sie unter <a href={`/admin/${hotelId}/restaurant/bestellung-einstellungen`}>Bestellung</a> ein. Ist sie aus, bleibt der Baustein unsichtbar.</p>
      </>);
    case "voucher":
      return (<>
        <LField name="heading" label="Überschrift" value={b.heading} max={200} langs={langs} />
        <LField name="intro" label="Einleitung" value={b.intro} rows={2} max={1000} langs={langs} />
        <p className="muted small">Beträge, Gültigkeit und Ein/Aus stellen Sie unter <a href={`/admin/${hotelId}/vouchers`}>Gutscheine</a> ein.</p>
      </>);
  }
}
