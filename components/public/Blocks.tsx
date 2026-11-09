import { and, asc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { roomTypes, type Hotel } from "@/src/db/schema";
import { lookClass, tr, type Block } from "@/src/domain/blocks";
import { RichText } from "./RichText";
import { roomDescription, roomName } from "@/src/domain/i18n-names";
import { addDays, todayIn } from "@/src/domain/dates";
import { t, type Locale } from "@/src/i18n/dict";
import { SearchBar } from "./SearchBar";

function Paras({ text }: { text: string }) {
  return <RichText text={text} />;
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".0", "")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function DownloadsBlock({ files, hotel, lang }: { files: string[]; hotel: Hotel; lang: Locale }) {
  const lib = new Map((hotel.content.documents ?? []).map((d) => [d.url, d]));
  const docs = files.map((u) => lib.get(u)).filter((d): d is NonNullable<typeof d> => !!d);
  if (!docs.length) return null;
  return (
    <ul className="downloads">
      {docs.map((d) => (
        <li key={d.url}>
          <a href={d.url} target="_blank" rel="noopener">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14h6M9 17h4" /></svg>
            <span>{tr(d.title, lang)}</span>
            <span className="small">PDF · {fileSize(d.bytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Heading({ text, level = 2 }: { text: string; level?: 1 | 2 }) {
  if (!text) return null;
  return level === 1 ? <h1>{text}</h1> : <h2>{text}</h2>;
}

async function RoomsBlock({ hotel, lang }: { hotel: Hotel; lang: Locale }) {
  const d = t(lang);
  const rooms = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder));
  return (
    <div className="grid">
      {rooms.map((r) => (
        <article key={r.id} className="card">
          {r.photos[0] ? <img className="room-photo" src={r.photos[0].url} alt={r.photos[0].alt ?? roomName(r, lang)} loading="lazy" /> : null}
          {r.photos.length > 1 ? (
            <div className="thumbs">{r.photos.slice(1).map((p) => <a key={p.url} href={p.url} target="_blank"><img src={p.url} alt={p.alt ?? roomName(r, lang)} loading="lazy" /></a>)}</div>
          ) : null}
          <h3>{roomName(r, lang)}</h3>
          {roomDescription(r, lang) ? <p className="muted small">{roomDescription(r, lang)}</p> : null}
          <p className="small">{d.upTo} {r.maxOccupancy} {d.persons}</p>
        </article>
      ))}
    </div>
  );
}

/** Rendert die Bausteine einer Seite. Der erste "hero" wird als Seitentitel (h1) verwendet. */
export async function Blocks({ blocks, hotel, lang, base, pageTitle }: { blocks: Block[]; hotel: Hotel; lang: Locale; base: string; pageTitle: string }) {
  const today = todayIn(hotel.timezone);
  const action = `${base}/${lang}/book`;
  const defaults = { checkin: addDays(today, 1), checkout: addDays(today, 3), adults: 2 };
  const hasHero = blocks.some((b) => b.type === "hero");
  const out: React.ReactNode[] = [];
  if (!hasHero && pageTitle) out.push(<h1 key="title" style={{ marginTop: 32 }}>{pageTitle}</h1>);
  for (const b of blocks) {
    switch (b.type) {
      case "hero":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-hero">
            {b.image ? <img className="hero-photo" src={b.image.url} alt={b.image.alt ?? ""} /> : null}
            <div className="hero">
              <Heading text={tr(b.headline, lang) || hotel.name} level={1} />
              {tr(b.intro, lang) ? <Paras text={tr(b.intro, lang)} /> : null}
            </div>
            {b.showSearch ? <SearchBar action={action} locale={lang} today={today} defaults={defaults} /> : null}
          </section>,
        );
        break;
      case "text":
        out.push(<section key={b.id} id={`b-${b.id}`} className={`blk blk-text ${lookClass(b)}`}><Heading text={tr(b.heading, lang)} /><Paras text={tr(b.body, lang)} /></section>);
        break;
      case "image_text":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className={`blk blk-imgtext ${b.imageSide === "right" ? "img-right" : ""} ${lookClass(b)}`}>
            {b.image ? <img src={b.image.url} alt={b.image.alt ?? ""} loading="lazy" /> : <div />}
            <div><Heading text={tr(b.heading, lang)} /><Paras text={tr(b.body, lang)} /></div>
          </section>,
        );
        break;
      case "gallery":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk">
            <Heading text={tr(b.heading, lang)} />
            <div className="gallery">{b.images.map((im) => <a key={im.url} href={im.url} target="_blank"><img src={im.url} alt={im.alt ?? ""} loading="lazy" /></a>)}</div>
          </section>,
        );
        break;
      case "rooms":
        out.push(<section key={b.id} id={`b-${b.id}`} className="blk"><Heading text={tr(b.heading, lang) || t(lang).rooms} /><RoomsBlock hotel={hotel} lang={lang} /></section>);
        break;
      case "booking":
        out.push(<section key={b.id} id={`b-${b.id}`} className="blk"><Heading text={tr(b.heading, lang)} /><SearchBar action={action} locale={lang} today={today} defaults={defaults} /></section>);
        break;
      case "facts":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk">
            <Heading text={tr(b.heading, lang)} />
            <dl className="facts">
              {b.items.map((it, i) => (
                <div key={i}><dt>{tr(it.label, lang)}</dt><dd>{tr(it.value, lang)}</dd></div>
              ))}
            </dl>
          </section>,
        );
        break;
      case "location": {
        const addr = b.address || [hotel.addressLine, [hotel.postalCode, hotel.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        out.push(
          <section key={b.id} id={`b-${b.id}`} className={`blk blk-location ${lookClass(b)}`}>
            <Heading text={tr(b.heading, lang)} />
            {addr ? <p><strong>{addr}</strong><br /><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`} target="_blank" rel="noopener">{lang === "de" ? "Route planen" : "Get directions"}</a></p> : null}
            <Paras text={tr(b.body, lang)} />
          </section>,
        );
        break;
      }
      case "downloads":
        out.push(<section key={b.id} id={`b-${b.id}`} className="blk blk-downloads"><Heading text={tr(b.heading, lang)} /><DownloadsBlock files={b.files} hotel={hotel} lang={lang} /></section>);
        break;
      case "notice":
        out.push(<section key={b.id} id={`b-${b.id}`} className={`blk ${lookClass(b)}`}><div className="notice"><Paras text={tr(b.body, lang)} /></div></section>);
        break;
    }
  }
  return <>{out}</>;
}
