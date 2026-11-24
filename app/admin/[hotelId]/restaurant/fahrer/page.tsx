import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Notice } from "@/components/admin/Notice";
import { AutoRefresh } from "@/components/public/AutoRefresh";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { PosError } from "@/src/services/pos";
import { completeOrder, notAccepted, outForDelivery, screenOrders } from "@/src/services/online-orders";
import { addressKey } from "@/src/domain/online-order";
import { formatChf } from "@/src/domain/money";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

async function act(f: FormData) {
  "use server";
  const c = await requireHotelModule("restaurant", s(f, "hotelId"), "staff", "driver");
  const id = s(f, "id");
  const name = c.user.name || c.user.email;
  try {
    if (s(f, "do") === "out") await outForDelivery(c.hotel, id, name, c.actor);
    if (s(f, "do") === "done") await completeOrder(c.hotel, id, c.actor);
    if (s(f, "do") === "refused") await notAccepted(c.hotel, id, c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; redirect(`/admin/${c.hotel.id}/restaurant/fahrer?msg=${encodeURIComponent(`Nicht möglich: ${e.message}`)}`); }
  redirect(`/admin/${c.hotel.id}/restaurant/fahrer`);
}

/** Fahrer-Ansicht (SPEC 20.5): Lieferungen mit Adresse, Telefon, Betrag; Unterwegs / Geliefert / Nicht angenommen */
export default async function DriverPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, user } = await requireHotelModule("restaurant", hotelId, "staff", "driver");
  const { open, flagged } = await screenOrders(hotel.id);
  const me = user.name || user.email;
  const list = open.filter((o) => o.kind === "delivery" && ["accepted", "ready", "out"].includes(o.status) && (o.status !== "out" || o.driver === me || !o.driver));
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const F = ({ id, d, label, cls }: { id: string; d: string; label: string; cls?: string }) => <form action={act}>{H}<input type="hidden" name="id" value={id} /><input type="hidden" name="do" value={d} /><button className={cls ?? "btn"}>{label}</button></form>;
  return (
    <div className="stack">
      <AutoRefresh seconds={20} />
      <h1 className="sr-only">Lieferungen</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {list.length ? list.map((o) => {
        const addr = `${o.street} ${o.houseNo}, ${o.postalCode} ${o.city}`;
        return (
          <section key={o.id} className="card stack" data-testid={`delivery-${o.number}`}>
            <h2>{o.number} · {formatInTimeZone(o.promisedAt ?? o.requestedAt, hotel.timezone, "HH:mm")} {o.status === "ready" ? <span className="badge">bereit</span> : o.status === "out" ? <span className="badge">unterwegs</span> : <span className="badge warn">in der Küche</span>}</h2>
            <p><strong>{addr}</strong>{o.floor ? ` · ${o.floor}` : ""}{o.bell ? ` · Klingel ${o.bell}` : ""}{o.addressHint ? <><br /><span className="small">{o.addressHint}</span></> : null}
              {flagged.has(addressKey(o.street, o.houseNo, o.postalCode)) ? <><br /><span className="badge danger">früher nicht angenommen</span></> : null}</p>
            <p>{o.name} · <a href={`tel:${o.phone}`}>{o.phone}</a></p>
            <p>{o.payment === "card" ? <span className="badge">bezahlt</span> : <strong>Bar einkassieren: {formatChf(o.totalRappen)}</strong>}</p>
            <p className="small"><a href={`https://maps.apple.com/?daddr=${encodeURIComponent(addr)}`}>Apple Karten</a> · <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`}>Google Maps</a></p>
            <div className="inline-form">
              {o.status !== "out" ? <F id={o.id} d="out" label="Unterwegs" /> : <F id={o.id} d="done" label={o.payment === "cash" ? "Geliefert, bar erhalten" : "Geliefert"} />}
              {o.status === "out" ? <details><summary className="small">Nicht angenommen</summary><F id={o.id} d="refused" label="Gast nicht angetroffen / nicht angenommen" cls="btn danger small" /></details> : null}
            </div>
          </section>
        );
      }) : <p className="muted">Keine offenen Lieferungen.</p>}
    </div>
  );
}
