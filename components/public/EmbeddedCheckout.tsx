"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Stripe Checkout eingebettet (SPEC 19.25). Die Karteneingabe liegt in einem Rahmen von Stripe; Kartendaten erreichen nie unseren Server.
 * Stripe.js wird von js.stripe.com geladen (Stripe verlangt das), die Funktion `createEmbeddedCheckoutPage` und `fetchClientSecret` stehen in der Stripe-Doku.
 * Bei Direct Charges wird Stripe.js mit `{ stripeAccount }` initialisiert (im Teststand am 20.11.2026 geprüft, QUESTIONS.md).
 */
type StripeJs = (key: string, opts?: { stripeAccount?: string }) => { createEmbeddedCheckoutPage: (o: { fetchClientSecret: () => Promise<string> }) => Promise<{ mount: (el: HTMLElement) => void; destroy: () => void }> };
declare global { interface Window { Stripe?: StripeJs } }

const SRC = "https://js.stripe.com/endive/stripe.js";

let mounting: Promise<void> = Promise.resolve();

// Ein einziges Laden pro Seite (der Entwicklungsmodus mountet doppelt; Stripe warnt sonst «mehrfach geladen»)
let stripePromise: Promise<StripeJs> | null = null;
function loadStripe(): Promise<StripeJs> {
  if (stripePromise) return stripePromise;
  stripePromise = new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js ohne Stripe")));
    s.onerror = () => reject(new Error("Stripe.js nicht geladen"));
    document.head.appendChild(s);
  });
  stripePromise.catch(() => { stripePromise = null; }); // nach einem Fehler beim nächsten Versuch neu laden
  return stripePromise;
}

export function EmbeddedCheckout(props: { clientSecret: string; publishableKey: string; stripeAccount?: string; errorText: string; cancelHref?: string; cancelText?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let checkout: { destroy: () => void } | null = null;
    let gone = false;
    // Stripe erlaubt nur ein eingebettetes Checkout-Objekt zugleich: Aufbau und Abbau laufen nacheinander
    // (React mountet im Entwicklungsmodus doppelt, und beim Wechsel der Sitzung wird neu aufgebaut).
    const run = mounting.then(async () => {
      if (gone) return;
      try {
        const Stripe = await loadStripe();
        const stripe = Stripe(props.publishableKey, props.stripeAccount ? { stripeAccount: props.stripeAccount } : undefined);
        const c = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret: async () => props.clientSecret });
        if (gone || !box.current) return c.destroy();
        checkout = c;
        c.mount(box.current);
      } catch (e) {
        console.error("Stripe-Rahmen konnte nicht geladen werden:", e);
        if (!gone) setFailed(true);
      }
    });
    mounting = run.then(() => undefined, () => undefined);
    return () => { gone = true; checkout?.destroy(); };
  }, [props.clientSecret, props.publishableKey, props.stripeAccount]);
  return (
    // Im Raster der Angebotskarte über die ganze Breite (sonst schrumpft der Stripe-Rahmen auf die Spaltenbreite des Knopfs)
    <div style={{ gridColumn: "1 / -1", width: "100%", minWidth: 0 }}>
      {failed ? <p className="notice warn" role="alert">{props.errorText}</p> : null}
      <div ref={box} className="stripe-embed" />
      {props.cancelHref ? <p className="small" style={{ marginTop: 16 }}><a href={props.cancelHref}>{props.cancelText}</a></p> : null}
    </div>
  );
}
