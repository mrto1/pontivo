"use client";
import { useEffect, useState } from "react";
import { t, type Locale } from "@/src/i18n/dict";

export function BookingForm(props: {
  locale: Locale;
  hotelSlug: string;
  roomTypeId: string;
  ratePlanId: string;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  ages: number[];
  base: string;
  /** Hotel verkauft Gutscheine → Feld «Gutschein einlösen» anzeigen */
  vouchers?: boolean;
}) {
  const d = t(props.locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Absenden erst nach der Hydrierung (sonst würde der Browser die Daten per GET an die URL hängen)
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hotel: props.hotelSlug,
        room_type_id: props.roomTypeId,
        rate_plan_id: props.ratePlanId,
        checkin: props.checkin,
        checkout: props.checkout,
        adults: props.adults,
        children: props.children,
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
      }),
    }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      window.location.href = j.checkout_url;
      return;
    }
    setBusy(false);
    const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
    setError(res?.status === 409 ? d.soldOut : code === "voucher_invalid" || code === "voucher_expired" || code === "voucher_empty" ? d[code] : d.error);
  }

  return (
    <form onSubmit={submit}>
      <h3 style={{ marginTop: 16 }}>{d.yourDetails}</h3>
      <div className="form-grid">
        <div><label>{d.firstName}</label><input name="first_name" required autoComplete="given-name" /></div>
        <div><label>{d.lastName}</label><input name="last_name" required autoComplete="family-name" /></div>
        <div><label>{d.email}</label><input name="email" type="email" required autoComplete="email" /></div>
        <div><label>{d.phone}</label><input name="phone" type="tel" autoComplete="tel" /></div>
      </div>
      <div style={{ marginTop: 12 }}><label>{d.notes}</label><textarea name="notes" rows={2} /></div>
      {props.vouchers ? (
        <details className="voucher-redeem" style={{ marginTop: 12 }}>
          <summary className="small">{d.voucherHave}</summary>
          <div style={{ marginTop: 8, maxWidth: 320 }}>
            <label>{d.voucherCodeLabel}</label>
            <input name="voucher" placeholder="GS-XXXX-XXXX" autoComplete="off" style={{ textTransform: "uppercase" }} />
            <p className="small muted">{d.voucherHint}</p>
          </div>
        </details>
      ) : null}
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" name="marketing" />{d.marketing}</label>
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
      <button className="btn" type="submit" disabled={busy || !ready} style={{ marginTop: 12 }}>{d.payNow}</button>
      <p className="muted small">{d.payMethods}</p>
    </form>
  );
}
