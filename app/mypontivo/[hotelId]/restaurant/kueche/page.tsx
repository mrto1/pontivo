import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, markDone, openTickets, type Station } from "@/src/services/pos";
import { AutoRefresh } from "@/components/public/AutoRefresh";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function done(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "kitchen");
  await requireModule(c.hotel.id, "restaurant");
  const st = s(f, "station") === "bar" ? "bar" : "kitchen";
  try { await markDone(c.hotel.id, f.getAll("lineId").map(String), c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; }
  redirect(`/mypontivo/${c.hotel.id}/restaurant/kueche?station=${st}`);
}

/** Küchenbildschirm im Browser (SPEC 19.49 Etappe B): offene Posten je Station, «Fertig» je Bestellung oder Zeile, lädt von selbst neu */
export default async function KitchenPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "kitchen");
  await requireModule(hotel.id, "restaurant");
  const station: Station = sp.station === "bar" ? "bar" : "kitchen";
  const tickets = await openTickets(hotel.id, station);
  const now = Date.now();
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const base = `/mypontivo/${hotel.id}/restaurant/kueche`;
  return (
    <div className="stack">
      <AutoRefresh seconds={10} />
      <h1>Küche</h1>
      <p className="tabs-inline">
        <Link className={station === "kitchen" ? "btn small" : "btn secondary small"} href={`${base}?station=kitchen`}>Küche</Link>{" "}
        <Link className={station === "bar" ? "btn small" : "btn secondary small"} href={`${base}?station=bar`}>Bar</Link>
      </p>
      {tickets.length ? (
        <div className="kds-grid" data-testid="kds">
          {tickets.map((t) => {
            const min = Math.max(0, Math.floor((now - t.since.getTime()) / 60000));
            return (
              <section key={t.orderId} className={`card stack kds-ticket${min >= 15 ? " late" : ""}`}>
                <h2>{t.table ?? (t.label || "Ohne Tisch")} <span className="small muted">{min} Min.</span></h2>
                <ul className="kds-lines">
                  {t.lines.map((l) => (
                    <li key={l.id}>
                      <form action={done}>{H}<input type="hidden" name="station" value={station} /><input type="hidden" name="lineId" value={l.id} />
                        <button className="kds-line" aria-label={`${l.quantity} × ${l.description} fertig`}>{l.quantity} × {l.description}{l.mode === "takeaway" ? " (Take-away)" : ""}</button></form>
                    </li>
                  ))}
                </ul>
                <form action={done}>{H}<input type="hidden" name="station" value={station} />{t.lines.map((l) => <input key={l.id} type="hidden" name="lineId" value={l.id} />)}
                  <button className="btn">Alles fertig</button></form>
              </section>
            );
          })}
        </div>
      ) : <p className="muted">Nichts offen.</p>}
      <p className="small muted">Antippen einer Zeile meldet sie als fertig. Die Seite aktualisiert sich alle 10 Sekunden. Welche Station ein Artikel hat, stellen Sie unter Einstellungen → Verkauf → Restaurant ein.</p>
    </div>
  );
}
