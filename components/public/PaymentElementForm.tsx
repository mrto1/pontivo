"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/src/i18n/dict";
import { PAY } from "@/src/i18n/pay";
import { loadStripe } from "./EmbeddedCheckout";

/**
 * Payment Element (SPEC 19.52): Zahlungsformular im Look des Hotels. Die Eingabefelder liegen in Rahmen von Stripe,
 * Kartendaten erreichen nie unseren Server. Farben, Schrift und Rundung kommen aus dem Design des Hotels (CSS-Variablen, auch Dunkelmodus).
 * Stripe-Doku: «Accept a payment» (Payment Element), Appearance API, `confirmPayment` mit `redirect: "if_required"`.
 * Alle Fehlerfälle (Laden, Ablehnung, Netz, Zeitüberschreitung, abgelaufene Reservation, TWINT-Rückkehr) werden hier abgefangen.
 */
type StripeError = { type?: string; code?: string; message?: string };
type PaymentIntentLite = { status: string };
type ElementsStripe = (key: string, opts?: { stripeAccount?: string; locale?: string }) => {
  elements: (o: { clientSecret: string; appearance?: unknown; locale?: string }) => {
    create: (type: "payment", o?: unknown) => { mount: (el: HTMLElement) => void; destroy: () => void; on: (ev: "ready" | "loaderror", cb: (e?: { error?: StripeError }) => void) => void };
  };
  confirmPayment: (o: { elements: unknown; confirmParams: { return_url: string }; redirect: "if_required" }) => Promise<{ error?: StripeError; paymentIntent?: PaymentIntentLite }>;
};

const LOAD_TIMEOUT_MS = 20_000;
const CONFIRM_TIMEOUT_MS = 60_000;

/** Eine beliebige CSS-Farbe (auch var(), color-mix) in rgb(...) auflösen, damit Stripe sie versteht */
function resolveColor(host: HTMLElement, value: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = fallback;
  probe.style.color = value;
  host.appendChild(probe);
  const c = getComputedStyle(probe).color;
  host.removeChild(probe);
  return c || fallback;
}
function luminance(rgb: string): number {
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
  return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
}

/** Aussehen aus dem Design des Hotels (die öffentliche Seite setzt --brand, --surface, --ink, --danger) */
export function appearanceFrom(host: HTMLElement) {
  const bg = resolveColor(host, "var(--surface, #fff)", "#ffffff");
  const dark = luminance(bg) < 0.5;
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      colorPrimary: resolveColor(host, "var(--brand, var(--accent, #2f5d50))", "#2f5d50"),
      colorBackground: bg,
      colorText: resolveColor(host, "var(--ink, #1a1a1a)", dark ? "#eeeeee" : "#1a1a1a"),
      colorDanger: resolveColor(host, "var(--danger, #b42318)", "#b42318"),
      // ASSUMPTION: Systemschrift des Hotels; eigene Webfonts erreicht der Stripe-Rahmen nur über `fonts` (cssSrc), das bauen wir bei Bedarf nach.
      fontFamily: getComputedStyle(host).fontFamily || "system-ui, sans-serif",
      borderRadius: "8px",
      spacingUnit: "4px",
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function PaymentElementForm(props: {
  locale: Locale;
  clientSecret: string;
  publishableKey: string;
  stripeAccount?: string;
  /** Adresse, zu der Stripe nach der Zahlung zurückleitet (Buchungsseite mit ?paid=1); TWINT und 3-D-Secure kehren hierher zurück */
  returnUrl: string;
  cancelHref?: string;
  payLabel?: string;
}) {
  const T = PAY[props.locale];
  // Stripe verlangt eine absolute Rückkehr-Adresse
  const returnUrl = typeof window === "undefined" ? props.returnUrl : new URL(props.returnUrl, window.location.origin).href;
  const box = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<ReturnType<ElementsStripe> | null>(null);
  const elementsRef = useRef<unknown>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "loadfail">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let element: { destroy: () => void } | null = null;
    let gone = false;
    setPhase("loading");
    const timer = setTimeout(() => { if (!gone) setPhase((p) => (p === "loading" ? "loadfail" : p)); }, LOAD_TIMEOUT_MS);
    (async () => {
      try {
        const S = (await loadStripe()) as unknown as ElementsStripe;
        if (gone || !box.current) return;
        const stripe = S(props.publishableKey, { ...(props.stripeAccount ? { stripeAccount: props.stripeAccount } : {}), locale: props.locale });
        const elements = stripe.elements({ clientSecret: props.clientSecret, appearance: appearanceFrom(box.current), locale: props.locale });
        const pe = elements.create("payment", { layout: "tabs" });
        pe.on("ready", () => { if (!gone) { clearTimeout(timer); setPhase("ready"); } });
        pe.on("loaderror", () => { if (!gone) { clearTimeout(timer); setPhase("loadfail"); } });
        pe.mount(box.current);
        element = pe;
        stripeRef.current = stripe;
        elementsRef.current = elements;
      } catch (e) {
        console.error("Zahlungsformular konnte nicht geladen werden:", e);
        if (!gone) { clearTimeout(timer); setPhase("loadfail"); }
      }
    })();
    return () => { gone = true; clearTimeout(timer); element?.destroy(); };
  }, [props.clientSecret, props.publishableKey, props.stripeAccount, props.locale, attempt]);

  const submit = useCallback(async (ev: React.FormEvent) => {
    ev.preventDefault();
    const stripe = stripeRef.current;
    if (!stripe || !elementsRef.current || busy) return; // Doppelklick: nur ein Versuch gleichzeitig
    setBusy(true);
    setMsg(null);
    setSlow(false);
    try {
      const r = await withTimeout(stripe.confirmPayment({ elements: elementsRef.current, confirmParams: { return_url: returnUrl }, redirect: "if_required" }), CONFIRM_TIMEOUT_MS);
      if (r === "timeout") { setSlow(true); setMsg(T.errSlow); return; }
      const { error, paymentIntent } = r;
      if (error) {
        const code = error.code ?? "";
        if (error.type === "validation_error") return; // Stripe zeigt den Hinweis am Feld selbst
        if (code === "payment_intent_unexpected_state" || code === "payment_intent_payment_attempt_expired" || code === "resource_missing") setMsg(T.errExpired);
        else if (error.type === "api_connection_error" || error.type === "rate_limit_error" || error.type === "api_error") setMsg(T.errNetwork);
        else if (error.type === "card_error") setMsg(error.message || T.errDeclined); // Stripe liefert den Text in der Sprache des Gasts
        else setMsg(T.errGeneric);
        return;
      }
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
        window.location.href = returnUrl; // Bestätigt wird die Buchung vom Webhook; die Seite wartet darauf
        return;
      }
      setMsg(paymentIntent?.status === "requires_payment_method" ? T.errDeclined : T.errGeneric);
    } catch (e) {
      console.error("Zahlung:", e);
      setMsg(T.errNetwork); // Netz weg, Stripe.js nicht erreichbar o. Ä.
    } finally {
      setBusy(false);
    }
  }, [busy, returnUrl, T]);

  return (
    <form onSubmit={submit} style={{ gridColumn: "1 / -1", width: "100%", minWidth: 0 }} noValidate>
      {phase === "loading" ? <p className="muted small" role="status">{T.loading}</p> : null}
      {phase === "loadfail" ? (
        <div className="notice warn" role="alert">
          <p className="m0">{T.errLoad}</p>
          <p className="mt8"><button type="button" className="btn secondary small" onClick={() => setAttempt((n) => n + 1)}>{T.retry}</button></p>
        </div>
      ) : null}
      <div ref={box} aria-busy={phase === "loading"} />
      {msg ? (
        <div className="notice warn mt16" role="alert">
          <p className="m0">{msg}</p>
          {slow ? <p className="mt8"><a className="btn secondary small" href={returnUrl}>{T.checkStatus}</a></p> : null}
        </div>
      ) : null}
      {phase === "ready" ? (
        <>
          <button className="btn mt16" disabled={busy || slow} style={{ width: "100%" }}>{busy ? T.paying : props.payLabel ?? T.pay}</button>
          <p className="small muted mt8">{T.secure}</p>
        </>
      ) : null}
      {props.cancelHref ? <p className="small mt16"><a href={props.cancelHref}>{T.abort}</a></p> : null}
    </form>
  );
}
