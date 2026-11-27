import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { feePercentText } from "@/src/domain/fee";
import { ZodError } from "zod";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { listVouchers, redeemVoucher, updateVoucherSettings, voucherSettings, vouchersAvailable, VoucherError } from "@/src/services/vouchers";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";
import { env } from "@/src/env";
import { isBookable } from "@/src/services/hotels";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";

const chf = (v: string) => decimalToRappen(v.replace(/[^\d.]/g, "") || "0");

async function saveSettings(f: FormData) {
  "use server";
  await hotelAction(f, { page: "vouchers", role: "manager", ok: "Einstellungen gespeichert" }, async (c) => {
    await updateVoucherSettings(c.hotel.id, {
      enabled: f.get("enabled") === "on",
      amounts: s(f, "amounts").split(/[,;\s]+/).filter(Boolean).map(chf),
      minRappen: chf(s(f, "min")), maxRappen: chf(s(f, "max")), validityYears: Number(s(f, "years")) || 3,
    }, c.actor);
  });
}

async function redeem(f: FormData) {
  "use server";
  await hotelAction(f, { page: "vouchers", area: "vouchers", fail: "Nicht eingelöst", keep: { q: s(f, "code") } }, async (c) => {
    const v = await redeemVoucher(c.hotel, s(f, "code"), chf(s(f, "amount")), s(f, "note"), c.actor);
    return `Eingelöst. Restwert ${v.code}: ${formatChf(v.remainingRappen)}`;
  });
}

export default async function Vouchers({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("vouchers", hotelId, "staff", "vouchers");
  const canEdit = atLeast(role, "manager");
  const set = voucherSettings(hotel);
  const list = await listVouchers(hotel.id, sp.q);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const paid = list.filter((v) => v.status === "paid");
  const open = paid.reduce((a, v) => a + v.remainingRappen, 0);
  return (
    <div className="stack">
      <h1 className="sr-only">Gutscheine</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}

      <section className="card stack">
        <h2>Einlösen</h2>
        <form action={redeem} className="inline-form">
          {hidden}
          <div><label htmlFor="f92f71">Code</label><input className="upper" id="f92f71" name="code" required placeholder="GS-XXXX-XXXX" defaultValue={sp.q ?? ""} /></div>
          <div><label htmlFor="f92f72">Betrag CHF</label><input id="f92f72" name="amount" required inputMode="decimal" placeholder="z. B. 120" /></div>
          <div style={{ minWidth: 220 }}><label htmlFor="f92f73">Notiz (optional)</label><input id="f92f73" name="note" maxLength={200} placeholder="z. B. Abendessen 12.3." /></div>
          <button className="btn">Einlösen</button>
        </form>
        <p className="muted small">Teilbeträge sind möglich, der Restwert bleibt auf dem Gutschein. Abgelaufene oder unbezahlte Gutscheine werden abgelehnt.</p>
      </section>

      <section className="card stack">
        <h2>Verkaufte Gutscheine</h2>
        <form className="inline-form" method="get"><div><label htmlFor="f92f74">Suchen (Code oder Name)</label><input id="f92f74" name="q" defaultValue={sp.q ?? ""} /></div><button className="btn secondary small">Suchen</button></form>
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
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={set.enabled} />Gutscheine online verkaufen {vouchersAvailable(hotel) ? <span className="badge ml8">aktiv</span> : null}</label>
            <div className="form-grid">
              <div><label htmlFor="f92f75">Beträge zur Auswahl (CHF, mit Komma getrennt)</label><input id="f92f75" name="amounts" defaultValue={set.amounts.map((a) => a / 100).join(", ")} /></div>
              <div><label htmlFor="f92f76">Eigener Betrag: mindestens CHF</label><input id="f92f76" name="min" inputMode="decimal" defaultValue={set.minRappen / 100} /></div>
              <div><label htmlFor="f92f77">höchstens CHF</label><input id="f92f77" name="max" inputMode="decimal" defaultValue={set.maxRappen / 100} /></div>
              <div><label htmlFor="f92f78">Gültigkeit (Jahre)</label><input id="f92f78" name="years" type="number" min={1} max={10} defaultValue={set.validityYears} /></div>
            </div>
          </fieldset>
          {canEdit ? <div><button className="btn small">Speichern</button></div> : null}
        </form>
        <p className="muted small">Auf der Website zeigen Sie das Formular mit dem Baustein «Gutscheine». Bezahlung wie bei Buchungen (TWINT, Karte), das Geld geht direkt an Sie, Pontivo behält {feePercentText(hotel.platformFeeBps)} %. Die Gültigkeitsdauer bitte rechtlich prüfen lassen.</p>
      </section>
    </div>
  );
}
