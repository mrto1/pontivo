"use client";
import { useEffect, useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

/** Merkt sich pro Gerät, dass hier schon ein Passkey benutzt oder angelegt wurde (nur ein Hinweis, kein Geheimnis) */
export const PASSKEY_FLAG = "pontivo.passkey";
export const rememberPasskey = () => { try { localStorage.setItem(PASSKEY_FLAG, "1"); } catch { /* ohne Speicher: kein Autostart */ } };
const knownDevice = () => { try { return localStorage.getItem(PASSKEY_FLAG) === "1"; } catch { return false; } };

/**
 * «Mit Passkey anmelden»: Kachel mit Fingerabdruck-Symbol. Auf Geräten, die schon einen Passkey benutzt haben, startet die Anmeldung
 * von selbst beim Öffnen der Seite (nicht nach einem Fehler oder bei einer Rückkehr mit Meldung). Sonst bietet das E-Mail-Feld
 * den Passkey als Vorschlag an (Conditional UI).
 */
export function PasskeyLogin() {
  const [supported, setSupported] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function finish(autofill: boolean) {
    const options = await (await fetch("/api/auth/passkey/options", { method: "POST" })).json();
    const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
    const r = await fetch("/api/auth/passkey/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
    if (r.ok) { rememberPasskey(); window.location.href = (await r.json()).mfa ? "/admin/login/2fa" : "/admin"; return; }
    throw new Error("verify");
  }

  useEffect(() => {
    const ok = typeof window !== "undefined" && !!window.PublicKeyCredential;
    setSupported(ok);
    if (!ok || started.current) return;
    started.current = true;
    const quiet = new URLSearchParams(window.location.search).has("error") || new URLSearchParams(window.location.search).has("emailchanged");
    (async () => {
      try {
        if (knownDevice() && !quiet) { setBusy(true); await finish(false); return; }
        if (await PublicKeyCredential.isConditionalMediationAvailable?.()) await finish(true);
      } catch { setBusy(false); /* abgebrochen oder nicht möglich: die Kachel bleibt */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!supported) return null;

  async function go() {
    setBusy(true); setMsg("");
    try {
      await finish(false);
    } catch {
      setMsg("Anmeldung mit Passkey nicht möglich oder abgebrochen. Sie können es erneut versuchen oder sich mit Passwort anmelden.");
      setBusy(false);
    }
  }
  return (
    <div className="stack gap8">
      <button type="button" className="passkey-tile" onClick={go} disabled={busy} data-testid="passkey-login">
        <span className="passkey-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 11a3 3 0 0 1 3 3c0 2-.5 3.8-1.5 5.5" />
            <path d="M9 14c0 2.2-.4 4-1.2 5.5" />
            <path d="M6 14a6 6 0 0 1 11.6-2" />
            <path d="M4 12a8 8 0 0 1 14.5-4.7" />
            <path d="M12 14c0 3-.6 5.2-1.7 7" />
            <path d="M18 17c-.1 1-.3 2-.6 2.9" />
          </svg>
        </span>
        <span className="passkey-text">
          <strong>{busy ? "Warte auf Ihr Gerät …" : "Mit Passkey anmelden"}</strong>
          <span>Fingerabdruck, Gesicht oder Gerätecode. Kein Passwort nötig.</span>
        </span>
        <span className="passkey-go" aria-hidden="true">→</span>
      </button>
      {msg ? <p className="notice warn small" role="alert">{msg}</p> : null}
    </div>
  );
}
