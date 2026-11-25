"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/src/i18n/dict";
import { PAY } from "@/src/i18n/pay";
import { PaymentElementForm } from "./PaymentElementForm";

/**
 * «Zahlung fortsetzen» auf der Buchungsseite einer noch reservierten Buchung (SPEC 19.52):
 * nach Seitenwechsel, abgebrochener TWINT-Zahlung, abgelehnter Karte oder wenn die Rückkehr verloren ging.
 */
type State =
  | { s: "loading" }
  | { s: "open"; clientSecret: string; publishableKey: string; stripeAccount?: string }
  | { s: "waiting" }
  | { s: "gone" }
  | { s: "error" };

export function ResumePayment(props: { locale: Locale; token: string; returnUrl: string; rebookHref: string; failedReturn?: boolean }) {
  const T = PAY[props.locale];
  const [st, setSt] = useState<State>({ s: "loading" });
  const [n, setN] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const res = await fetch(`/api/bookings/${props.token}/pay`, { method: "POST" });
        if (stop) return;
        if (!res.ok) { setSt({ s: "error" }); return; }
        const j = (await res.json()) as { state: string; confirmed?: boolean; client_secret?: string; publishable_key?: string; stripe_account?: string };
        if (j.confirmed) { window.location.href = props.returnUrl; return; }
        if (j.state === "open" && j.client_secret && j.publishable_key) setSt({ s: "open", clientSecret: j.client_secret, publishableKey: j.publishable_key, stripeAccount: j.stripe_account });
        else if (j.state === "paid" || j.state === "processing") { setSt({ s: "waiting" }); timer = setTimeout(() => setN((x) => x + 1), 3000); } // wir warten auf den Webhook
        else setSt({ s: "gone" });
      } catch {
        if (!stop) setSt({ s: "error" });
      }
    })();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [props.token, props.returnUrl, n]);

  if (st.s === "loading") return null;
  if (st.s === "waiting") return <p className="notice" role="status">{T.pending}</p>;
  if (st.s === "gone") return <p className="notice warn">{T.gone} <a href={props.rebookHref}>{T.rebook}</a></p>;
  if (st.s === "error") return <p className="notice warn" role="alert">{T.errNetwork} <button type="button" className="btn secondary small" onClick={() => setN((x) => x + 1)}>{T.retry}</button></p>;
  return (
    <div className="card mt16">
      <p className={props.failedReturn ? "notice warn" : "muted"}>{props.failedReturn ? T.failedReturn : T.resumeLead}</p>
      <PaymentElementForm locale={props.locale} clientSecret={st.clientSecret} publishableKey={st.publishableKey} stripeAccount={st.stripeAccount} returnUrl={props.returnUrl} />
    </div>
  );
}
