"use client";
import { useEffect, useState } from "react";

function keyToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Mitteilungen für dieses Gerät ein-/ausschalten (neue Buchung, Anfrage, Storno, Überbuchung) */
export function PushToggle({ hotelId }: { hotelId: string }) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "denied" | "ios">("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = `/api/admin/hotels/${hotelId}/push`;

  async function registration() {
    return (await navigator.serviceWorker.getRegistration("/admin/")) ?? navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" });
  }

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (ios && !standalone) return setState("ios"); // iPhone: erst zum Home-Bildschirm hinzufügen
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        const r = await fetch(`${api}${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`);
        const j = await r.json();
        if (!j.configured) return setState("unsupported");
        setPublicKey(j.publicKey);
        if (Notification.permission === "denied") return setState("denied");
        setState(sub && j.subscribed ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    })();
  }, [api]);

  async function enable() {
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey!) }));
      const r = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Fehler");
      setState("on");
    } catch (e) {
      setError((e as Error).message || "Mitteilungen konnten nicht eingeschaltet werden.");
    }
  }

  async function disable() {
    setError(null);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(api, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Mitteilungen konnten nicht ausgeschaltet werden.");
    }
  }

  if (state === "loading" || state === "unsupported") return null;
  if (state === "ios") return <p className="muted small">Mitteilungen auf dem iPhone: Zuerst die App zum Home-Bildschirm hinzufügen und von dort öffnen.</p>;
  if (state === "denied") return <p className="muted small">Mitteilungen sind in den Browser- bzw. Geräteeinstellungen blockiert.</p>;
  return (
    <>
      {state === "on" ? (
        <button type="button" className="btn secondary small" onClick={disable}>Mitteilungen ausschalten</button>
      ) : (
        <button type="button" className="btn secondary small" onClick={enable}>Mitteilungen einschalten</button>
      )}
      {state === "on" ? <p className="muted small">Dieses Gerät erhält Mitteilungen bei neuen Buchungen, Anfragen, Stornos und Überbuchungen.</p> : null}
      {error ? <p className="notice warn small">{error}</p> : null}
    </>
  );
}
