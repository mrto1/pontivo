"use client";
import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

/** «Mit Passkey anmelden»: Fingerabdruck, Gesicht oder Gerätecode statt E-Mail-Link */
export function PasskeyLogin() {
  const [supported, setSupported] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSupported(typeof window !== "undefined" && !!window.PublicKeyCredential); }, []);
  if (!supported) return null;

  async function go() {
    setBusy(true); setMsg("");
    try {
      const options = await (await fetch("/api/auth/passkey/options", { method: "POST" })).json();
      const response = await startAuthentication({ optionsJSON: options });
      const r = await fetch("/api/auth/passkey/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
      if (r.ok) { window.location.href = "/admin"; return; }
      setMsg("Anmeldung mit Passkey nicht möglich. Bitte den E-Mail-Link verwenden.");
    } catch {
      setMsg("Abgebrochen. Sie können es erneut versuchen oder den E-Mail-Link verwenden.");
    }
    setBusy(false);
  }
  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      <button type="button" className="btn" onClick={go} disabled={busy} data-testid="passkey-login">Mit Passkey anmelden</button>
      {msg ? <p className="notice warn small">{msg}</p> : null}
      <p className="small muted" style={{ textAlign: "center" }}>oder per E-Mail-Link:</p>
    </div>
  );
}
