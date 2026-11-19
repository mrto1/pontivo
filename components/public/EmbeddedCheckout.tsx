"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Stripe Checkout eingebettet (SPEC 19.25). Die Karteneingabe liegt in einem Rahmen von Stripe; Kartendaten erreichen nie unseren Server.
 * Stripe.js wird von js.stripe.com geladen (Stripe verlangt das), die Funktion `createEmbeddedCheckoutPage` und `fetchClientSecret` stehen in der Stripe-Doku.
 * ASSUMPTION: Bei Direct Charges wird Stripe.js mit `{ stripeAccount }` initialisiert (steht in den abgerufenen Doku-Seiten nicht; vor dem Einschalten im Teststand prüfen).
 */
type StripeJs = (key: string, opts?: { stripeAccount?: string }) => { createEmbeddedCheckoutPage: (o: { fetchClientSecret: () => Promise<string> }) => Promise<{ mount: (el: HTMLElement) => void; destroy: () => void }> };
declare global { interface Window { Stripe?: StripeJs } }

const SRC = "https://js.stripe.com/endive/stripe.js";

function loadStripe(): Promise<StripeJs> {
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js ohne Stripe")));
    s.onerror = () => reject(new Error("Stripe.js nicht geladen"));
    document.head.appendChild(s);
  });
}

export function EmbeddedCheckout(props: { clientSecret: string; publishableKey: string; stripeAccount?: string; errorText: string; cancelHref?: string; cancelText?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let checkout: { destroy: () => void } | null = null;
    let gone = false;
    (async () => {
      try {
        const Stripe = await loadStripe();
        const stripe = Stripe(props.publishableKey, props.stripeAccount ? { stripeAccount: props.stripeAccount } : undefined);
        const c = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret: async () => props.clientSecret });
        if (gone || !box.current) return c.destroy();
        checkout = c;
        c.mount(box.current);
      } catch {
        if (!gone) setFailed(true);
      }
    })();
    return () => { gone = true; checkout?.destroy(); };
  }, [props.clientSecret, props.publishableKey, props.stripeAccount]);
  return (
    <div>
      {failed ? <p className="notice warn" role="alert">{props.errorText}</p> : null}
      <div ref={box} />
      {props.cancelHref ? <p className="small" style={{ marginTop: 16 }}><a href={props.cancelHref}>{props.cancelText}</a></p> : null}
    </div>
  );
}
