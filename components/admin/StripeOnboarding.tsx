"use client";
import { useEffect, useState } from "react";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";

/**
 * Stripe-Konto direkt im Einrichtungs-Assistenten eröffnen (eingebettete Stripe-Komponente).
 * Fällt bei Ladefehlern auf das gehostete Onboarding zurück (Knopf daneben).
 */
export function StripeOnboarding({ hotelId, publishableKey, privacyUrl, returnTo }: { hotelId: string; publishableKey: string; privacyUrl: string; returnTo?: string }) {
  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const inst = loadConnectAndInitialize({
      publishableKey,
      locale: "de",
      fetchClientSecret: async () => {
        const r = await fetch(`/api/admin/hotels/${hotelId}/stripe-session`, { method: "POST" });
        const j = await r.json();
        if (!r.ok || !j.client_secret) {
          setError(j.error ?? "Stripe ist gerade nicht erreichbar.");
          throw new Error(j.error ?? "stripe_session");
        }
        return j.client_secret as string;
      },
      appearance: {
        variables: {
          colorPrimary: "#2f5d50",
          fontFamily: "Inter, system-ui, sans-serif",
          borderRadius: "8px",
        },
      },
    });
    setInstance(inst);
  }, [hotelId, publishableKey]);

  async function exit() {
    setDone(true);
    await fetch(`/api/admin/hotels/${hotelId}/stripe-session`, { method: "PUT" }).catch(() => null);
    window.location.href = returnTo ?? `/admin/${hotelId}/einrichten?step=zahlungen&stripe=return`;
  }

  if (error) return <p className="notice warn">{error} Bitte den Knopf zur Stripe-Seite verwenden.</p>;
  if (done) return <p className="notice">Angaben gespeichert. Status wird geprüft …</p>;
  if (!instance) return <p className="muted">Stripe wird geladen …</p>;
  return (
    <div className="stripe-embed">
      <ConnectComponentsProvider connectInstance={instance}>
        <ConnectAccountOnboarding
          onExit={exit}
          privacyPolicyUrl={privacyUrl}
          collectionOptions={{ fields: "eventually_due", futureRequirements: "include" }}
          onLoadError={({ error: e }) => setError(e.message || "Stripe konnte nicht geladen werden.")}
        />
      </ConnectComponentsProvider>
    </div>
  );
}
