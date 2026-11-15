"use client";
import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

/** «Mit Passkey anmelden»: Fingerabdruck, Gesicht oder Gerätecode statt E-Mail-Link */
export function PasskeyLogin() {
  const [supported, setSupported] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ok = typeof window !== "undefined" && !!window.PublicKeyCredential;
    setSupported(ok);
    if (!ok) return;
    // Autofill: Passkey wird im E-Mail-Feld als Vorschlag angeboten (Conditional UI), ohne Knopfdruck
    (async () => {
      try {
        if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return;
        await finish(true);
      } catch { /* abgebrochen oder nicht möglich: der Knopf bleibt */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!supported) return null;

  async function finish(autofill: boolean) {
    const options = await (await fetch("/api/auth/passkey/options", { method: "POST" })).json();
    const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
    const r = await fetch("/api/auth/passkey/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
    if (r.ok) { window.location.href = (await r.json()).mfa ? "/admin/login/2fa" : "/admin"; return; }
    throw new Error("verify");
  }

  async function go() {
    setBusy(true); setMsg("");
    try {
      await finish(false);
    } catch {
      setMsg("Anmeldung mit Passkey nicht möglich oder abgebrochen. Sie können es erneut versuchen oder den E-Mail-Link verwenden.");
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      <button type="button" className="btn" onClick={go} disabled={busy} data-testid="passkey-login">Mit Passkey anmelden</button>
      {msg ? <p className="notice warn small">{msg}</p> : null}
      <p className="small muted" style={{ textAlign: "center" }}>oder per E-Mail-Link:</p>
    </div>
  );
}
