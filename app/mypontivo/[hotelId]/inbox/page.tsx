import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { moduleRows, requireModule } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { atLeast } from "@/src/auth/session";
import { InboxError, closeThread, listThreads, openThread, replyToThread } from "@/src/services/inbox";
import { listInquiries, setInquiryStatus } from "@/src/services/inquiries";
import { createOfferFromInquiry, listOffers, OfferError } from "@/src/services/offers";
import { OFFER_STATUS_LABEL } from "@/src/domain/offers";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const KIND: Record<string, string> = { table: "Tisch reservieren", group: "Gruppe", seminar: "Seminar / Tagung", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anderes" };
const fmt = (d: Date) => d.toLocaleString("de-CH", { timeZone: "Europe/Zurich", dateStyle: "short", timeStyle: "short" });

async function reply(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "inbox");
  await requireModule(c.hotel.id, "inbox");
  const id = s(f, "threadId");
  let msg = "Antwort gesendet.";
  try {
    await replyToThread(c.hotel.id, id, String(f.get("text") ?? ""), c.actor);
  } catch (e) {
    if (!(e instanceof InboxError)) throw e;
    msg = `Nicht gesendet: ${e.message}`;
  }
  redirect(`/mypontivo/${c.hotel.id}/inbox?thread=${id}&msg=${encodeURIComponent(msg)}`);
}

async function close(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "inbox");
  await requireModule(c.hotel.id, "inbox");
  let msg = "Unterhaltung abgeschlossen.";
  try {
    await closeThread(c.hotel.id, s(f, "threadId"), c.actor);
  } catch (e) {
    if (!(e instanceof InboxError)) throw e;
    msg = `Nicht abgeschlossen: ${e.message}`;
  }
  redirect(`/mypontivo/${c.hotel.id}/inbox?msg=${encodeURIComponent(msg)}`);
}

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "manager");
  await setInquiryStatus(c.hotel.id, String(f.get("id")), f.get("status") === "done" ? "done" : "new", c.actor);
  redirect(`/mypontivo/${c.hotel.id}/inbox?quelle=web`);
}

async function makeOffer(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "manager");
  await requireModule(c.hotel.id, "inquiries");
  try {
    const o = await createOfferFromInquiry(c.hotel, String(f.get("id")), c.actor);
    redirect(`/mypontivo/${c.hotel.id}/offers/${o.id}`);
  } catch (e) {
    if (!(e instanceof OfferError)) throw e;
    redirect(`/mypontivo/${c.hotel.id}/inbox?quelle=web`);
  }
}

/** Gemeinsamer Posteingang: Anfragen von der Website und aus dem Chat sowie Nachrichten der Portale (Booking.com, Airbnb, Expedia) */
export default async function InboxPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "inbox");
  const rows = await moduleRows(hotel.id);
  const webOn = isOn(rows, "inquiries");
  const portalOn = isOn(rows, "inbox");
  const canEdit = atLeast(role, "manager");
  // Quelle: alles | web (Website und Chat) | portal
  const quelle = sp.quelle === "web" && webOn ? "web" : sp.quelle === "portal" && portalOn ? "portal" : sp.thread && portalOn ? "portal" : "alle";
  const showWeb = webOn && quelle !== "portal";
  const showPortal = portalOn && quelle !== "web";
  const closed = sp.closed === "1";
  const threads = showPortal ? await listThreads(hotel.id, { closed }) : [];
  const open = showPortal && sp.thread ? await openThread(hotel.id, sp.thread) : null;
  const list = showWeb ? await listInquiries(hotel.id) : [];
  const offerList = showWeb ? await listOffers(hotel.id) : [];
  const offersOf = (id: string) => offerList.filter((o) => o.inquiryId === id);
  const openInq = list.filter((x) => x.status === "new").length;
  const unread = threads.reduce((n, { t }) => n + (t.unread ?? 0), 0);
  const q = (v: string) => `/mypontivo/${hotel.id}/inbox${v === "alle" ? "" : `?quelle=${v}`}`;
  const sources = [{ k: "alle", label: "Alle" }, ...(webOn ? [{ k: "web", label: "Website und Chat" }] : []), ...(portalOn ? [{ k: "portal", label: "Portale" }] : [])];
  return (
    <div className="stack">
      <h1>Posteingang</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <div className="cal-tools">
        {sources.length > 2 ? (
          <div className="seg" role="group" aria-label="Quelle">
            {sources.map((x) => <a key={x.k} href={q(x.k)} className={x.k === quelle ? "on" : ""}>{x.label}</a>)}
          </div>
        ) : null}
        <p className="muted small" style={{ margin: 0 }}>
          {webOn ? <>Anfragen von der Website und aus dem Chat kommen auch per E-Mail an {hotel.contactEmail}. {openInq ? <strong>{openInq} offen. </strong> : null}</> : null}
          {portalOn ? <>Portal-Nachrichten beantworten Sie hier, die Antwort geht über den Channel-Manager ans Portal. {unread ? <strong>{unread} ungelesen.</strong> : null}</> : null}
        </p>
      </div>

      {showWeb ? (
        <section className="stack" id="anfragen">
          <h2>Anfragen von der Website und aus dem Chat</h2>
          {list.length ? (
            <div className="stack">
              {list.map((x) => (
                <article key={x.id} className="card stack" style={{ opacity: x.status === "done" ? 0.65 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                    <h3 style={{ margin: 0 }}>{KIND[x.kind] ?? x.kind} · {x.name}</h3>
                    <span className="small muted">{x.createdAt.toLocaleString("de-CH", { timeZone: hotel.timezone })} · Sprache {x.language.toUpperCase()}{x.pageSlug ? ` · Seite /${x.pageSlug}` : ""}</span>
                  </div>
                  <div className="kv small">
                    <span className="muted">E-Mail</span><a href={`mailto:${x.email}?subject=${encodeURIComponent(`Ihre Anfrage – ${hotel.name}`)}`}>{x.email}</a>
                    {x.phone ? (<><span className="muted">Telefon</span><a href={`tel:${x.phone.replace(/\s/g, "")}`}>{x.phone}</a></>) : null}
                    {x.dateFrom ? (<><span className="muted">Datum</span><span>{formatDay(x.dateFrom, "de")}{x.dateTo ? ` – ${formatDay(x.dateTo, "de")}` : ""}{x.timeOfDay ? `, ${x.timeOfDay} Uhr` : ""}</span></>) : null}
                    {x.persons ? (<><span className="muted">Personen</span><span>{x.persons}</span></>) : null}
                  </div>
                  {x.message ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{x.message}</p> : null}
                  {offersOf(x.id).map((o) => <p key={o.id} className="small" style={{ margin: 0 }}>Angebot: <a href={`/mypontivo/${hotel.id}/offers/${o.id}`}>{o.title}</a> · {OFFER_STATUS_LABEL[o.status]}</p>)}
                  {canEdit && x.kind !== "table" ? (
                    <form action={makeOffer}>
                      <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={x.id} />
                      <button className="btn small">Angebot erstellen</button>
                    </form>
                  ) : null}
                  {canEdit ? (
                    <form action={toggle}>
                      <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="status" value={x.status === "new" ? "done" : "new"} />
                      <button className="btn secondary small">{x.status === "new" ? "Als erledigt markieren" : "Wieder öffnen"}</button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          ) : <p className="muted">Noch keine Anfragen. Fügen Sie auf einer Seite den Baustein «Anfrageformular» ein, z. B. auf «Seminare» oder «Hochzeiten».</p>}
        </section>
      ) : null}

      {showPortal ? (
        <section className="stack" id="portale">
          <h2>Nachrichten von Booking.com, Airbnb und Expedia</h2>
          <p><Link href={`/mypontivo/${hotel.id}/inbox${quelle === "portal" ? "?quelle=portal" : ""}`}>Offen</Link> · <Link href={`/mypontivo/${hotel.id}/inbox?${quelle === "portal" ? "quelle=portal&" : ""}closed=1`}>Abgeschlossen</Link></p>
          <div className="grid2">
            <section className="card">
              {threads.length ? (
                <ul className="list">
                  {threads.map(({ t, reference }) => (
                    <li key={t.id}>
                      <Link href={`/mypontivo/${hotel.id}/inbox?thread=${t.id}${closed ? "&closed=1" : ""}`}>
                        <strong>{t.unread ? `(${t.unread}) ` : ""}{t.provider || "Portal"}{reference ? ` · ${reference}` : ""}</strong>
                      </Link>
                      <div className="muted">{fmt(t.lastMessageAt)} · {t.lastMessage}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">Keine Unterhaltungen.</p>}
            </section>
            <section className="card stack">
              {open ? (
                <>
                  <h2>{open.thread.provider || "Portal"}{open.booking ? <> · <Link href={`/mypontivo/${hotel.id}/bookings/${open.booking.id}`}>{open.booking.reference}</Link></> : null}</h2>
                  <div className="stack">
                    {open.messages.map((m) => (
                      <div key={m.id} className={m.sender === "guest" ? "" : "muted"}>
                        <small>{m.sender === "guest" ? "Gast" : "Hotel"} · {fmt(m.createdAt)}</small>
                        <div style={{ whiteSpace: "pre-wrap" }}>{m.body || (m.attachments.length ? "(Anhang, im Portal ansehen)" : "")}</div>
                      </div>
                    ))}
                  </div>
                  {!open.thread.isClosed ? (
                    <>
                      <form action={reply} className="stack">
                        <input type="hidden" name="hotelId" value={hotel.id} />
                        <input type="hidden" name="threadId" value={open.thread.id} />
                        <label htmlFor="text">Antwort</label>
                        <textarea id="text" name="text" rows={4} maxLength={5000} required />
                        <div><button className="btn">Senden</button></div>
                      </form>
                      <form action={close}>
                        <input type="hidden" name="hotelId" value={hotel.id} />
                        <input type="hidden" name="threadId" value={open.thread.id} />
                        <button className="btn secondary">Abschliessen</button>
                      </form>
                    </>
                  ) : <p className="muted">Abgeschlossen.</p>}
                </>
              ) : <p className="muted">Unterhaltung links wählen.</p>}
            </section>
          </div>
        </section>
      ) : null}
    </div>
  );
}
