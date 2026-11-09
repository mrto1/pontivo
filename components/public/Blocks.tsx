import { and, asc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { roomTypes, type Hotel } from "@/src/db/schema";
import { lookClass, tr, type Block } from "@/src/domain/blocks";
import { RichText } from "./RichText";
import { MapEmbed } from "./MapEmbed";
import { fill } from "@/src/i18n/dict";
import { voucherSettings, vouchersAvailable } from "@/src/services/vouchers";
import { formatChf } from "@/src/domain/money";
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
export async function Blocks({ blocks, hotel, lang, base, pageTitle, pageSlug = "" }: { blocks: Block[]; hotel: Hotel; lang: Locale; base: string; pageTitle: string; pageSlug?: string }) {
  const d = t(lang);
  const here = `${base}/${lang}${pageSlug ? `/${pageSlug}` : ""}`;
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
            {addr ? <p><strong>{addr}</strong><br /><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`} target="_blank" rel="noopener">{t(lang).directions}</a></p> : null}
            <Paras text={tr(b.body, lang)} />
            {b.lat !== null && b.lng !== null ? <MapEmbed lat={b.lat} lng={b.lng} label={d.showMap} note={d.mapNote} title={hotel.name} /> : null}
          </section>,
        );
        break;
      }
      case "reviews": {
        const items = b.items.filter((it) => tr(it.quote, lang) && it.author && it.source);
        if (!items.length && !b.moreUrl) break;
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-reviews">
            <Heading text={tr(b.heading, lang)} />
            <div className="reviews">
              {items.map((it, i) => (
                <figure key={i} className="card review">
                  {it.rating ? <div className="stars" role="img" aria-label={fill(d.ratingOf, { n: it.rating })}>{"★".repeat(it.rating)}<span aria-hidden="true">{"★".repeat(5 - it.rating)}</span></div> : null}
                  <blockquote><RichText text={tr(it.quote, lang)} /></blockquote>
                  <figcaption className="small muted">
                    {it.author} · {it.url ? <a href={it.url} target="_blank" rel="noopener">{it.source}</a> : it.source}{it.date ? ` · ${it.date.slice(5)}.${it.date.slice(0, 4)}` : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
            {b.moreUrl ? <p><a href={b.moreUrl} target="_blank" rel="noopener">{d.reviewsMore}</a></p> : null}
          </section>,
        );
        break;
      }
      case "faq":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-faq">
            <Heading text={tr(b.heading, lang)} />
            <div className="faq">
              {b.items.filter((it) => tr(it.q, lang)).map((it, i) => (
                <details key={i} className="faq-item">
                  <summary>{tr(it.q, lang)}</summary>
                  <div><RichText text={tr(it.a, lang)} /></div>
                </details>
              ))}
            </div>
          </section>,
        );
        break;
      case "offers":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-offers">
            <Heading text={tr(b.heading, lang)} />
            <div className="grid">
              {b.items.filter((it) => tr(it.title, lang)).map((it, i) => {
                const q = new URLSearchParams({ ...(it.ratePlanId ? { plan: it.ratePlanId } : {}), nights: String(it.nights) });
                return (
                  <article key={i} className="card offer-card">
                    {it.image ? <img className="room-photo" src={it.image.url} alt={it.image.alt ?? ""} loading="lazy" /> : null}
                    <h3>{tr(it.title, lang)}</h3>
                    {it.nights > 1 ? <span className="badge">{fill(d.fromNights, { n: it.nights })}</span> : null}
                    <RichText text={tr(it.text, lang)} />
                    {tr(it.price, lang) ? <p className="offer-price">{tr(it.price, lang)}</p> : null}
                    <a className="btn" href={`${base}/${lang}/book?${q}`}>{d.bookOffer}</a>
                  </article>
                );
              })}
            </div>
          </section>,
        );
        break;
      case "tips":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-tips">
            <Heading text={tr(b.heading, lang)} />
            {tr(b.intro, lang) ? <RichText text={tr(b.intro, lang)} /> : null}
            <div className="grid">
              {b.items.filter((it) => tr(it.title, lang)).map((it, i) => (
                <article key={i} className="card tip">
                  {it.image ? <img className="room-photo" src={it.image.url} alt={it.image.alt ?? ""} loading="lazy" /> : null}
                  <div className="tip-tags">
                    <span className="badge">{d[`tip_${it.category}` as keyof typeof d]}</span>
                    {it.season !== "all" && !(it.category === "winter" && it.season === "winter") ? <span className="badge warn">{d[`season_${it.season}` as keyof typeof d]}</span> : null}
                    {tr(it.distance, lang) ? <span className="small muted">{tr(it.distance, lang)}</span> : null}
                  </div>
                  <h3>{tr(it.title, lang)}</h3>
                  <RichText text={tr(it.text, lang)} />
                  {it.url ? <p><a href={it.url} target="_blank" rel="noopener">{d.moreInfo}</a></p> : null}
                </article>
              ))}
            </div>
          </section>,
        );
        break;
      case "inquiry":
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-inquiry">
            <Heading text={tr(b.heading, lang)} />
            {tr(b.intro, lang) ? <RichText text={tr(b.intro, lang)} /> : null}
            <p id="anfrage-gesendet" className="notice target-only">{d.inqSent}</p>
            <p id="anfrage-fehler" className="notice warn target-only">{d.inqError}</p>
            <form className="card form-grid inquiry" action="/api/inquiry" method="post">
              <input type="hidden" name="hotel" value={hotel.slug} />
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="page" value={pageSlug} />
              <input type="hidden" name="back" value={here} />
              <div className="hp" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <div><label htmlFor={`k-${b.id}`}>{d.inqKind}</label>
                <select id={`k-${b.id}`} name="kind" required defaultValue={b.kinds[0]}>{b.kinds.map((k) => <option key={k} value={k}>{d[`kind_${k}` as keyof typeof d]}</option>)}</select>
              </div>
              <div><label htmlFor={`n-${b.id}`}>{d.inqName}</label><input id={`n-${b.id}`} name="name" required maxLength={120} autoComplete="name" /></div>
              <div><label htmlFor={`e-${b.id}`}>{d.email}</label><input id={`e-${b.id}`} name="email" type="email" required maxLength={200} autoComplete="email" /></div>
              <div><label htmlFor={`p-${b.id}`}>{d.phone}</label><input id={`p-${b.id}`} name="phone" type="tel" maxLength={40} autoComplete="tel" /></div>
              <div><label htmlFor={`f-${b.id}`}>{d.inqDateFrom}</label><input id={`f-${b.id}`} name="dateFrom" type="date" /></div>
              <div><label htmlFor={`t-${b.id}`}>{d.inqDateTo}</label><input id={`t-${b.id}`} name="dateTo" type="date" /></div>
              <div><label htmlFor={`c-${b.id}`}>{d.inqPersons}</label><input id={`c-${b.id}`} name="persons" type="number" min={1} max={2000} /></div>
              <div style={{ gridColumn: "1 / -1" }}><label htmlFor={`m-${b.id}`}>{d.inqMessage}</label><textarea id={`m-${b.id}`} name="message" rows={4} maxLength={4000} /></div>
              <div style={{ gridColumn: "1 / -1" }}><p className="small muted">{d.inqPrivacy}</p><button className="btn">{d.inqSend}</button></div>
            </form>
          </section>,
        );
        break;
      case "voucher": {
        const set = voucherSettings(hotel);
        const ok = vouchersAvailable(hotel);
        out.push(
          <section key={b.id} id={`b-${b.id}`} className="blk blk-voucher">
            <Heading text={tr(b.heading, lang) || d.vTitle} />
            {tr(b.intro, lang) ? <RichText text={tr(b.intro, lang)} /> : null}
            <p id="gutschein-fehler" className="notice warn target-only">{d.error}</p>
            {ok ? (
              <form className="card form-grid voucher-form" action="/api/vouchers" method="post">
                <input type="hidden" name="hotel" value={hotel.slug} />
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="back" value={here} />
                <div className="hp" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
                <fieldset className="plain" style={{ gridColumn: "1 / -1" }}>
                  <legend className="small muted">{d.vAmount}</legend>
                  <div className="amounts">
                    {set.amounts.map((a, i) => (
                      <label key={a} className="amount"><input type="radio" name="amount" value={a} defaultChecked={i === 1 || set.amounts.length === 1} required />{formatChf(a).replace(".00", "")}</label>
                    ))}
                    <label className="amount"><input type="radio" name="amount" value="other" />{d.vOther}</label>
                    <input name="other" inputMode="decimal" aria-label={d.vOther} placeholder={`${set.minRappen / 100}–${set.maxRappen / 100}`} style={{ maxWidth: 140 }} />
                  </div>
                </fieldset>
                <div><label htmlFor={`vr-${b.id}`}>{d.vFor}</label><input id={`vr-${b.id}`} name="recipientName" maxLength={120} /></div>
                <div><label htmlFor={`vb-${b.id}`}>{d.vFrom}</label><input id={`vb-${b.id}`} name="buyerName" required maxLength={120} autoComplete="name" /></div>
                <div><label htmlFor={`ve-${b.id}`}>{d.vEmail}</label><input id={`ve-${b.id}`} name="buyerEmail" type="email" required maxLength={200} autoComplete="email" /></div>
                <div style={{ gridColumn: "1 / -1" }}><label htmlFor={`vm-${b.id}`}>{d.vMessage}</label><textarea id={`vm-${b.id}`} name="message" rows={2} maxLength={500} /></div>
                <div style={{ gridColumn: "1 / -1" }}><p className="small muted">{d.vRedeem}</p><button className="btn">{d.vBuy}</button> <span className="small muted">{d.payMethods}</span></div>
              </form>
            ) : <p className="muted">{d.vUnavailable}</p>}
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
