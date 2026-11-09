import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { listVouchers, redeemVoucher, updateVoucherSettings, voucherSettings, vouchersAvailable, VoucherError } from "@/src/services/vouchers";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { env } from "@/src/env";
import { isBookable } from "@/src/services/hotels";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const chf = (v: string) => decimalToRappen(v.replace(/[^\d.]/g, "") || "0");

async function back(hotelId: string, msg: string, q = "") {
  redirect(`/admin/${hotelId}/vouchers?msg=${encodeURIComponent(msg)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
}

async function saveSettings(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg = "Einstellungen gespeichert";
  try {
    await updateVoucherSettings(c.hotel.id, {
      enabled: f.get("enabled") === "on",
      amounts: s(f, "amounts").split(/[,;\s]+/).filter(Boolean).map(chf),
      minRappen: chf(s(f, "min")), maxRappen: chf(s(f, "max")), validityYears: Number(s(f, "years")) || 3,
    }, c.actor);
  } catch (e) {
    if (!(e instanceof ZodError) && !(e instanceof Error && /Betrag/.test(e.message))) throw e;
    msg = `Nicht gespeichert: ${e instanceof ZodError ? e.issues.map((i) => i.message).join(", ") : e.message}`;
  }
  await back(c.hotel.id, msg);
}

async function redeem(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff");
  let msg: string;
  try {
    const v = await redeemVoucher(c.hotel, s(f, "code"), chf(s(f, "amount")), s(f, "note"), c.actor);
    msg = `Eingelöst. Restwert ${v.code}: ${formatChf(v.remainingRappen)}`;
  } catch (e) {
    if (!(e instanceof VoucherError)) throw e;
    msg = `Nicht eingelöst: ${e.message}`;
  }
  await back(c.hotel.id, msg, s(f, "code"));
}

export default async function Vouchers({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const set = voucherSettings(hotel);
  const list = await listVouchers(hotel.id, sp.q);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const paid = list.filter((v) => v.status === "paid");
  const open = paid.reduce((a, v) => a + v.remainingRappen, 0);
  return (
    <div className="stack">
      <h1>Gutscheine</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}

      <section className="card stack">
        <h2>Einlösen</h2>
        <form action={redeem} className="inline-form">
          {hidden}
          <div><label>Code</label><input name="code" required placeholder="GS-XXXX-XXXX" defaultValue={sp.q ?? ""} style={{ textTransform: "uppercase" }} /></div>
          <div><label>Betrag CHF</label><input name="amount" required inputMode="decimal" placeholder="z. B. 120" /></div>
          <div style={{ minWidth: 220 }}><label>Notiz (optional)</label><input name="note" maxLength={200} placeholder="z. B. Abendessen 12.3." /></div>
          <button className="btn">Einlösen</button>
        </form>
        <p className="muted small">Teilbeträge sind möglich, der Restwert bleibt auf dem Gutschein. Abgelaufene oder unbezahlte Gutscheine werden abgelehnt.</p>
      </section>

      <section className="card stack">
        <h2>Verkaufte Gutscheine</h2>
        <form className="inline-form" method="get"><div><label>Suchen (Code oder Name)</label><input name="q" defaultValue={sp.q ?? ""} /></div><button className="btn secondary small">Suchen</button></form>
        <p className="small muted">Offener Restwert aller bezahlten Gutscheine: <strong>{formatChf(open)}</strong></p>
        {list.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Code</th><th>Gekauft</th><th>Von / für</th><th>Wert</th><th>Restwert</th><th>Gültig bis</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td><a href={`/v/${v.publicToken}`} target="_blank">{v.code}</a></td>
                  <td className="small">{(v.paidAt ?? v.createdAt).toLocaleDateString("de-CH", { timeZone: hotel.timezone })}</td>
                  <td className="small">{v.buyerName}{v.recipientName ? ` → ${v.recipientName}` : ""}<br /><span className="muted">{v.buyerEmail}</span></td>
                  <td>{formatChf(v.amountRappen)}</td>
                  <td>{formatChf(v.remainingRappen)}</td>
                  <td className="small">{formatDay(v.validUntil, "de")}</td>
                  <td>{v.status === "paid" ? (v.remainingRappen ? <span className="badge">gültig</span> : <span className="badge warn">eingelöst</span>) : <span className="badge warn">Zahlung offen</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Noch keine Gutscheine.</p>}
      </section>

      <section className="card stack">
        <h2>Einstellungen</h2>
        {!isBookable(hotel, env().PAYMENT_PROVIDER) ? <p className="notice warn small">Online-Zahlung ist für dieses Hotel noch nicht eingerichtet. Gutscheine erscheinen erst danach auf der Website.</p> : null}
        <form action={saveSettings} className="stack">
          {hidden}
          <fieldset className="plain stack" disabled={!canEdit}>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={set.enabled} />Gutscheine online verkaufen {vouchersAvailable(hotel) ? <span className="badge" style={{ marginLeft: 8 }}>aktiv</span> : null}</label>
            <div className="form-grid">
              <div><label>Beträge zur Auswahl (CHF, mit Komma getrennt)</label><input name="amounts" defaultValue={set.amounts.map((a) => a / 100).join(", ")} /></div>
              <div><label>Eigener Betrag: mindestens CHF</label><input name="min" inputMode="decimal" defaultValue={set.minRappen / 100} /></div>
              <div><label>höchstens CHF</label><input name="max" inputMode="decimal" defaultValue={set.maxRappen / 100} /></div>
              <div><label>Gültigkeit (Jahre)</label><input name="years" type="number" min={1} max={10} defaultValue={set.validityYears} /></div>
            </div>
          </fieldset>
          {canEdit ? <div><button className="btn small">Speichern</button></div> : null}
        </form>
        <p className="muted small">Auf der Website zeigen Sie das Formular mit dem Baustein «Gutscheine». Bezahlung wie bei Buchungen (TWINT, Karte), das Geld geht direkt an Sie, Pontivo behält 1 %. Die Gültigkeitsdauer bitte rechtlich prüfen lassen.</p>
      </section>
    </div>
  );
}
