import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { addItem, deleteItem, disableUpsell, enableUpsell, listItems, setItemActive, upsellActive, upsellRow, upsellStats } from "@/src/services/upsell";
import { UPSELL_PROVISION_BPS } from "@/src/domain/upsell";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { tr } from "@/src/domain/blocks";
import { env } from "@/src/env";
import { isBookable } from "@/src/services/hotels";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UNITS = { per_booking: "pro Buchung", per_night: "pro Nacht", per_person: "pro Person", per_person_night: "pro Person und Nacht" } as const;

function back(hotelId: string, msg: string): never {
  redirect(`/admin/${hotelId}/upsell?msg=${encodeURIComponent(msg)}`);
}

async function enable(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  if (f.get("confirm") !== "on") back(c.hotel.id, "Nicht eingeschaltet: Bitte die Provision bestätigen.");
  if (!isBookable(c.hotel, env().PAYMENT_PROVIDER)) back(c.hotel.id, "Nicht eingeschaltet: Online-Zahlung ist noch nicht eingerichtet.");
  await enableUpsell(c.hotel, Number(s(f, "bps")), c.actor);
  back(c.hotel.id, "Upselling ist eingeschaltet.");
}

async function disable(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await disableUpsell(c.hotel, c.actor);
  back(c.hotel.id, "Upselling ist ausgeschaltet.");
}

async function add(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  try {
    await addItem(c.hotel.id, {
      nameDe: s(f, "nameDe"), nameEn: s(f, "nameEn"), descDe: s(f, "descDe"), descEn: s(f, "descEn"),
      priceRappen: decimalToRappen(s(f, "price").replace(/[^\d.]/g, "") || "0"), unit: s(f, "unit") as keyof typeof UNITS, maxQuantity: Number(s(f, "max")) || 1,
    }, c.actor);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    back(c.hotel.id, `Nicht gespeichert: ${e.issues.map((i) => i.message).join(", ")}`);
  }
  back(c.hotel.id, "Angebot gespeichert.");
}

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await setItemActive(c.hotel.id, s(f, "id"), f.get("active") === "1", c.actor);
  back(c.hotel.id, "Gespeichert.");
}

async function remove(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await deleteItem(c.hotel.id, s(f, "id"), c.actor);
  back(c.hotel.id, "Angebot gelöscht.");
}

export default async function Upsell({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const row = await upsellRow(hotel.id);
  const active = await upsellActive(hotel);
  const items = await listItems(hotel.id);
  const stats = await upsellStats(hotel.id);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const pct = (UPSELL_PROVISION_BPS / 100).toString().replace(".", ",");

  return (
    <div className="stack">
      <h1>Upselling</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}

      <section className="card stack">
        <h2>Extras per E-Mail verkaufen {active ? <span className="badge" style={{ marginLeft: 8 }}>aktiv</span> : null}</h2>
        <p className="small muted">
          Gäste, die dem Erhalt von Angeboten zugestimmt haben, bekommen 7 Tage vor der Anreise eine E-Mail mit Ihren Extras (z. B. Frühstück, Late Check-out, Ausflugspaket).
          Sie bezahlen direkt per TWINT oder Karte, das Geld geht an Ihr Stripe-Konto. Pontivo behält {pct} % der verkauften Extras. Keine Grundgebühr, kein Verkauf – keine Kosten.
        </p>
        {!isBookable(hotel, env().PAYMENT_PROVIDER) ? <p className="notice warn small">Online-Zahlung ist für dieses Hotel noch nicht eingerichtet.</p> : null}
        {canEdit ? (row.enabled ? (
          <form action={disable}>{hidden}<button className="btn secondary small">Ausschalten</button></form>
        ) : (
          <form action={enable} className="stack">
            {hidden}
            <input type="hidden" name="bps" value={UPSELL_PROVISION_BPS} />
            <label className="check"><input type="checkbox" name="confirm" />Ich bestätige die Provision von {pct} % auf verkaufte Extras (Gastgeber-Bedingungen Ziffer 8).</label>
            <div><button className="btn small">Einschalten</button></div>
          </form>
        )) : null}
      </section>

      <section className="card stack">
        <h2>Ihre Angebote</h2>
        {items.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Angebot</th><th>Preis</th><th>Max. Menge</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{tr(i.name, "de")}{tr(i.description, "de") ? <><br /><span className="muted small">{tr(i.description, "de")}</span></> : null}</td>
                  <td>{formatChf(i.priceRappen)} <span className="muted small">{UNITS[i.unit]}</span></td>
                  <td>{i.unit === "per_person" || i.unit === "per_person_night" ? "Personen" : i.maxQuantity}</td>
                  <td>{i.active ? <span className="badge">sichtbar</span> : <span className="badge warn">versteckt</span>}</td>
                  <td>{canEdit ? (
                    <div className="inline-form">
                      <form action={toggle}>{hidden}<input type="hidden" name="id" value={i.id} /><input type="hidden" name="active" value={i.active ? "0" : "1"} /><button className="btn secondary small">{i.active ? "Verstecken" : "Zeigen"}</button></form>
                      <form action={remove}>{hidden}<input type="hidden" name="id" value={i.id} /><button className="btn secondary small">Löschen</button></form>
                    </div>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Noch keine Angebote.</p>}
        {canEdit ? (
          <form action={add} className="stack">
            {hidden}
            <h3>Neues Angebot</h3>
            <div className="form-grid">
              <div><label>Name (Deutsch)</label><input name="nameDe" required maxLength={120} placeholder="z. B. Frühstück" /></div>
              <div><label>Name (Englisch, optional)</label><input name="nameEn" maxLength={120} /></div>
              <div><label>Beschreibung (Deutsch, optional)</label><input name="descDe" maxLength={400} /></div>
              <div><label>Beschreibung (Englisch, optional)</label><input name="descEn" maxLength={400} /></div>
              <div><label>Preis CHF</label><input name="price" required inputMode="decimal" placeholder="z. B. 18" /></div>
              <div><label>Preis gilt</label><select name="unit" defaultValue="per_person_night">{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label>Höchstmenge (bei «pro Buchung/Nacht»)</label><input name="max" type="number" min={1} max={20} defaultValue={1} /></div>
            </div>
            <div><button className="btn small">Angebot speichern</button></div>
            <p className="muted small">Weitere Sprachen (FR, IT, NL) fallen auf Englisch bzw. Deutsch zurück.</p>
          </form>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Verkäufe</h2>
        <p className="small">{stats.orders} Bestellungen, Umsatz <strong>{formatChf(stats.amountRappen)}</strong>, Provision an Pontivo {formatChf(stats.feeRappen)}.</p>
        {stats.recent.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Bezahlt</th><th>Buchung</th><th>Extras</th><th>Betrag</th></tr></thead>
            <tbody>
              {stats.recent.map((o) => (
                <tr key={o.id}>
                  <td className="small">{o.paidAt?.toLocaleDateString("de-CH", { timeZone: hotel.timezone })}</td>
                  <td>{o.reference}</td>
                  <td className="small">{o.lines.map((l) => `${l.quantity}× ${tr(l.name, "de")}`).join(", ")}</td>
                  <td>{formatChf(o.amountRappen)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Noch keine Verkäufe.</p>}
        <p className="muted small">Rückerstattungen nehmen Sie im Stripe-Dashboard vor.</p>
      </section>
    </div>
  );
}
