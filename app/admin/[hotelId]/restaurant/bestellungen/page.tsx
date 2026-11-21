import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Notice } from "@/components/admin/Notice";
import { OrderScreen } from "@/components/admin/OrderScreen";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError } from "@/src/services/pos";
import { acceptOrder, completeOrder, heartbeat, orderSettings, pauseOrders, readyOrder, rejectOrder, screenOrders } from "@/src/services/online-orders";
import { addressKey } from "@/src/domain/online-order";
import { formatChf } from "@/src/domain/money";
import type { OnlineOrder } from "@/src/db/schema";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (h: string, msg?: string): never => redirect(`/admin/${h}/restaurant/bestellungen${msg ? `?msg=${encodeURIComponent(msg)}` : ""}`);

async function act(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "onlineorders");
  await requireModule(c.hotel.id, "restaurant");
  const id = s(f, "id");
  try {
    switch (s(f, "do")) {
      case "accept": await acceptOrder(c.hotel, id, Number(s(f, "extra")), c.actor); break;
      case "reject": await rejectOrder(c.hotel, id, s(f, "reason"), c.actor); break;
      case "ready": await readyOrder(c.hotel, id, c.actor); break;
      case "complete": await completeOrder(c.hotel, id, c.actor); break;
      case "pause": { const m = s(f, "minutes"); await pauseOrders(c.hotel, m === "tomorrow" ? "tomorrow" : Number(m), c.actor); break; }
    }
  } catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, `Nicht möglich: ${e.message}`); }
  back(c.hotel.id);
}

async function beat(hotelId: string, i: { deviceKey: string; battery: number | null; charging: boolean | null; soundOk: boolean; label: string }) {
  "use server";
  const c = await requireHotel(hotelId, "staff", "onlineorders");
  await heartbeat(c.hotel.id, i.deviceKey, { battery: i.battery, charging: i.charging, soundOk: i.soundOk, label: i.label });
}

const REASONS = ["Zu viel Betrieb", "Artikel ausverkauft", "Ausserhalb des Liefergebiets", "Küche geschlossen"];

/** Bestellbildschirm (SPEC 20.4/20.5): neue Bestellungen annehmen oder ablehnen, «bereit», «abgeholt», Pause */
export default async function OrdersScreenPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "onlineorders");
  await requireModule(hotel.id, "restaurant");
  const [{ open, done, flagged }, cfg] = await Promise.all([screenOrders(hotel.id), orderSettings(hotel.id)]);
  const tz = hotel.timezone;
  const hm = (d: Date | null) => (d ? formatInTimeZone(d, tz, "HH:mm") : "");
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const waiting = open.filter((o) => o.status === "new");
  const paused = cfg.autoPaused || (cfg.pausedUntil && cfg.pausedUntil > new Date());
  const Btn = ({ o, d, children, extra, cls }: { o: OnlineOrder; d: string; children: React.ReactNode; extra?: Record<string, string>; cls?: string }) => (
    <form action={act}>{H}<input type="hidden" name="id" value={o.id} /><input type="hidden" name="do" value={d} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={cls ?? "btn"}>{children}</button></form>
  );
  const Card = ({ o }: { o: OnlineOrder }) => {
    const flag = o.kind === "delivery" && flagged.has(addressKey(o.street, o.houseNo, o.postalCode));
    return (
      <section className={`card stack order-card${o.status === "new" ? " new" : ""}`} data-testid={`order-${o.number}`}>
        <h2>{o.number} · {o.kind === "delivery" ? "Lieferung" : "Abholung"} {hm(o.promisedAt ?? o.requestedAt)} {o.isTest ? <span className="badge">Probe</span> : null}</h2>
        <p className="small">{o.name} · <a href={`tel:${o.phone}`}>{o.phone}</a> · {o.payment === "card" ? <span className="badge">bezahlt</span> : <span className="badge warn">bar {formatChf(o.totalRappen)}</span>}</p>
        {o.kind === "delivery" ? <p className="small">{o.street} {o.houseNo}, {o.postalCode} {o.city}{o.floor ? ` · ${o.floor}` : ""}{o.bell ? ` · Klingel ${o.bell}` : ""}{o.addressHint ? ` · ${o.addressHint}` : ""}{flag ? <> <span className="badge danger">früher nicht angenommen</span></> : null}</p> : null}
        <ul className="kds-lines">
          {o.items.map((l, i) => <li key={i}><strong>{l.quantity} ×</strong> {l.description}{l.options.length ? <span className="small"> ({l.options.map((x) => x.name).join(", ")})</span> : null}{l.note ? <span className="small muted"> – {l.note}</span> : null}</li>)}
        </ul>
        {o.note ? <p className="small"><strong>Hinweis:</strong> {o.note}</p> : null}
        <p className="small muted">Total {formatChf(o.totalRappen)}{o.deliveryFeeRappen ? ` (inkl. Liefergebühr ${formatChf(o.deliveryFeeRappen)})` : ""}</p>
        {o.status === "new" ? (
          <>
            <div className="inline-form" aria-label="Annehmen">
              <Btn o={o} d="accept" extra={{ extra: "0" }}>Annehmen {hm(o.requestedAt)}</Btn>
              {[10, 20, 30].map((m) => <Btn key={m} o={o} d="accept" extra={{ extra: String(m) }} cls="btn secondary">+{m} Min.</Btn>)}
            </div>
            <details><summary className="small">Ablehnen</summary>
              <form action={act} className="inline-form">{H}<input type="hidden" name="id" value={o.id} /><input type="hidden" name="do" value="reject" />
                <select name="reason" aria-label="Grund">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                <button className="btn danger small">Ablehnen{o.payment === "card" ? " und erstatten" : ""}</button></form>
            </details>
          </>
        ) : o.status === "accepted" ? (
          <div className="inline-form"><Btn o={o} d="ready">Bereit</Btn>{o.kind === "pickup" ? <Btn o={o} d="complete" cls="btn secondary">Abgeholt</Btn> : null}</div>
        ) : o.status === "ready" ? (
          o.kind === "pickup" ? <Btn o={o} d="complete">Abgeholt{o.payment === "cash" ? ` (bar ${formatChf(o.totalRappen)} kassiert)` : ""}</Btn> : <p className="small muted">Wartet auf Fahrer.</p>
        ) : o.status === "out" ? <p className="small muted">Unterwegs mit {o.driver || "Fahrer"} seit {hm(o.outAt)}.</p> : null}
      </section>
    );
  };
  return (
    <div className="stack">
      <h1>Online-Bestellungen {waiting.length ? <span className="badge danger">{waiting.length} neu</span> : null}</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <OrderScreen waiting={waiting.length} beat={beat.bind(null, hotel.id)} probe={sp.probe === "1"} />
      {!cfg.enabled && !open.some((o) => o.isTest) ? <p className="muted small">Die Online-Bestellung ist noch nicht live. <a href={`/admin/${hotel.id}/restaurant/bestellung-einstellungen`}>Einrichten</a></p> : null}
      {cfg.enabled ? (
        <div className="inline-form" data-testid="order-pause">
          {paused ? <><span className="badge warn">{cfg.autoPaused ? "Automatisch pausiert (kein Bildschirm erreichbar)" : `Pausiert bis ${hm(cfg.pausedUntil)}`}</span>
            <form action={act}>{H}<input type="hidden" name="do" value="pause" /><input type="hidden" name="minutes" value="0" /><button className="btn small">Wieder annehmen</button></form></>
            : <><span className="small muted">Keine neuen Bestellungen für</span>
              {[["30", "30 Min."], ["60", "1 Std."], ["tomorrow", "heute"]].map(([v, l]) => <form key={v} action={act}>{H}<input type="hidden" name="do" value="pause" /><input type="hidden" name="minutes" value={v} /><button className="btn secondary small">{l}</button></form>)}</>}
        </div>
      ) : null}
      {open.length ? <div className="kds-grid" data-testid="orders-open">{open.map((o) => <Card key={o.id} o={o} />)}</div> : <p className="muted">Keine offenen Bestellungen.</p>}
      {done.length ? (
        <details><summary>Erledigt heute ({done.length})</summary>
          <table className="table"><tbody>{done.map((o) => <tr key={o.id}><td>{o.number}</td><td>{o.name}</td><td>{({ completed: "erledigt", rejected: `abgelehnt: ${o.rejectReason}`, expired: "nicht angenommen, storniert", not_accepted: "Lieferung nicht angenommen" } as Record<string, string>)[o.status] ?? o.status}</td><td>{formatChf(o.totalRappen)}</td></tr>)}</tbody></table>
        </details>
      ) : null}
    </div>
  );
}
