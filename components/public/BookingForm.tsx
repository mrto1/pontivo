"use client";
import { useEffect, useState } from "react";
import { t, type Locale } from "@/src/i18n/dict";
import { D } from "@/src/i18n/direct";
import { extraAmount, extraMaxQuantity, perPerson, type ExtraUnit } from "@/src/domain/extras";
import { formatChf } from "@/src/domain/money";
import { solvePow } from "./pow-client";
import { EmbeddedCheckout } from "./EmbeddedCheckout";

export type FormExtra = { id: string; name: string; description: string; priceRappen: number; unit: ExtraUnit; maxQuantity: number; mandatory: boolean; active: boolean; roomTypeIds: string[] };

export function BookingForm(props: {
  locale: Locale;
  hotelSlug: string;
  roomTypeId: string;
  ratePlanId: string;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  /** Anzahl gleicher Zimmer (SPEC 19.6) */
  rooms?: number;
  ages: number[];
  base: string;
  /** Hotel verkauft Gutscheine → Feld «Gutschein einlösen» anzeigen */
  vouchers?: boolean;
  /** wählbare Zusatzleistungen (obligatorische sind schon im Preis) */
  extras?: FormExtra[];
  nights?: number;
  baseTotalRappen?: number;
  /** Firmencode (SPEC 19.29): wird mitgeschickt; `payOnInvoice` = ohne Kartenzahlung, Rechnung an die Firma */
  companyCode?: string;
  payOnInvoice?: boolean;
}) {
  const d = t(props.locale);
  const [pay, setPay] = useState<{ clientSecret: string; publishableKey: string; stripeAccount?: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Absenden erst nach der Hydrierung (sonst würde der Browser die Daten per GET an die URL hängen)
  const [ready, setReady] = useState(false);
  const extras = props.extras ?? [];
  const persons = props.adults + props.children;
  const [qty, setQty] = useState<Record<string, number>>({});
  const extrasTotal = extras.reduce((sum, e) => sum + extraAmount(e, qty[e.id] ?? 0, props.nights ?? 1), 0);
  useEffect(() => setReady(true), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    let pow = "";
    try { pow = await solvePow(); } catch { /* Server meldet den Fehler */ }
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pow,
        hotel: props.hotelSlug,
        room_type_id: props.roomTypeId,
        rate_plan_id: props.ratePlanId,
        checkin: props.checkin,
        checkout: props.checkout,
        adults: props.adults,
        children: props.children,
        rooms: props.rooms ?? 1,
        children_ages: props.ages,
        guest: {
          first_name: f.get("first_name"),
          last_name: f.get("last_name"),
          email: f.get("email"),
          phone: f.get("phone") || null,
          language: props.locale,
          notes: f.get("notes") || null,
          marketing_consent: f.get("marketing") === "on",
        },
        terms_accepted: f.get("terms") === "on",
        voucher_code: String(f.get("voucher") ?? "").trim() || null,
        company_code: props.companyCode || null,
        extras: Object.entries(qty).filter(([, q]) => q > 0).map(([id, quantity]) => ({ id, quantity })),
      }),
    }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      if (j.client_secret && j.publishable_key) { setPay({ clientSecret: j.client_secret, publishableKey: j.publishable_key, stripeAccount: j.stripe_account, token: j.token }); setBusy(false); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      window.location.href = j.checkout_url;
      return;
    }
    setBusy(false);
    const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
    setError(res?.status === 409 ? d.soldOut : code === "voucher_invalid" || code === "voucher_expired" || code === "voucher_empty" ? d[code] : code === "code_invalid" ? D[props.locale].codeInvalid : code === "voucher_not_with_invoice" ? D[props.locale].invoiceFail : d.error);
  }

  if (pay) {
    return <EmbeddedCheckout clientSecret={pay.clientSecret} publishableKey={pay.publishableKey} stripeAccount={pay.stripeAccount} errorText={d.error} cancelHref={`${props.base}/b/${pay.token}?cancelled_payment=1`} cancelText={d.payAbort} />;
  }

  return (
    <form onSubmit={submit}>
      {extras.length ? (
        <fieldset className="plain extras-pick mt16">
          <legend><h3 className="m0">{d.extras}</h3></legend>
          {extras.map((e) => {
            const max = extraMaxQuantity(e, persons);
            const q = qty[e.id] ?? 0;
            return (
              <div key={e.id} className="extra-row">
                <div>
                  <strong>{e.name}</strong> <span className="muted small">{formatChf(e.priceRappen)} {d[`unit_${e.unit}`]}</span>
                  {e.description ? <div className="small muted">{e.description}</div> : null}
                </div>
                {max === 1 ? (
                  <label className="check m0"><input type="checkbox" checked={q === 1} onChange={(ev) => setQty({ ...qty, [e.id]: ev.target.checked ? 1 : 0 })} aria-label={e.name} /></label>
                ) : (
                  <select value={q} onChange={(ev) => setQty({ ...qty, [e.id]: Number(ev.target.value) })} aria-label={`${e.name}: ${perPerson(e.unit) ? d.extrasPersons : d.extrasQty}`} style={{ width: 130 }}>
                    {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{i}{perPerson(e.unit) && i ? ` ${d.extrasPersons}` : ""}</option>)}
                  </select>
                )}
                <span className="extra-amount">{q ? formatChf(extraAmount(e, q, props.nights ?? 1)) : ""}</span>
              </div>
            );
          })}
          {props.baseTotalRappen !== undefined ? <p className="extra-total"><span>{d.total}</span><strong>{formatChf(props.baseTotalRappen + extrasTotal)}</strong></p> : null}
        </fieldset>
      ) : null}
      <h3 className="mt16">{d.yourDetails}</h3>
      <div className="form-grid">
        <div><label>{d.firstName}</label><input name="first_name" required autoComplete="given-name" /></div>
        <div><label>{d.lastName}</label><input name="last_name" required autoComplete="family-name" /></div>
        <div><label>{d.email}</label><input name="email" type="email" required autoComplete="email" /></div>
        <div><label>{d.phone}</label><input name="phone" type="tel" autoComplete="tel" /></div>
      </div>
      <div className="mt12"><label>{d.notes}</label><textarea name="notes" rows={2} /></div>
      {props.vouchers && !props.payOnInvoice ? (
        <details className="voucher-redeem mt12">
          <summary className="small">{d.voucherHave}</summary>
          <div style={{ marginTop: 8, maxWidth: 320 }}>
            <label>{d.voucherCodeLabel}</label>
            <input className="upper" name="voucher" placeholder="GS-XXXX-XXXX" autoComplete="off" />
            <p className="small muted">{d.voucherHint}</p>
          </div>
        </details>
      ) : null}
      <label className="check mt12"><input type="checkbox" name="marketing" />{d.marketing}</label>
      <label className="check">
        <input type="checkbox" name="terms" required />
        <span>
          {t(props.locale).accept1}
          <a href={`${props.base}/${props.locale}/agb`} target="_blank">{t(props.locale).acceptTerms}</a>
          {t(props.locale).accept2}
          <a href={`${props.base}/${props.locale}/datenschutz`} target="_blank">{t(props.locale).acceptPrivacy}</a>
          {t(props.locale).accept3}
        </span>
      </label>
      {error ? <p className="notice warn" role="alert">{error}</p> : null}
      <button className="btn mt12" type="submit" disabled={busy || !ready} >{props.payOnInvoice ? D[props.locale].payInvoice : d.payNow}</button>
      <p className="muted small">{props.payOnInvoice ? D[props.locale].invoiceNote : d.payMethods}</p>
    </form>
  );
}
