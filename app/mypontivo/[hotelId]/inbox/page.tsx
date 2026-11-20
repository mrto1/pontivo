import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { InboxError, closeThread, listThreads, openThread, replyToThread } from "@/src/services/inbox";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
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

export default async function InboxPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "inbox");
  await requireModule(hotel.id, "inbox");
  const closed = sp.closed === "1";
  const threads = await listThreads(hotel.id, { closed });
  const open = sp.thread ? await openThread(hotel.id, sp.thread) : null;
  return (
    <div className="stack">
      <h1>Posteingang</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="muted">Nachrichten von Gästen über Booking.com, Airbnb und Expedia. Antworten gehen über den Channel-Manager an das Portal.</p>
      <p><Link href={`/mypontivo/${hotel.id}/inbox`}>Offen</Link> · <Link href={`/mypontivo/${hotel.id}/inbox?closed=1`}>Abgeschlossen</Link></p>
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
    </div>
  );
}
