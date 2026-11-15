"use client";
import { useEffect, useState } from "react";

/** Hinweis für Konten ohne Passkey (ausblendbar, nur in diesem Browser gemerkt) */
export function PasskeyNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem("pk-nudge") !== "off" && !!window.PublicKeyCredential); } catch { setShow(true); }
  }, []);
  if (!show) return null;
  return (
    <p className="notice small" data-testid="passkey-nudge">
      Schneller und sicherer anmelden: <a href="/admin/konto">Passkey einrichten</a> (Fingerabdruck oder Gesicht statt E-Mail-Link).{" "}
      <button type="button" className="linklike" onClick={() => { try { localStorage.setItem("pk-nudge", "off"); } catch { /* egal */ } setShow(false); }}>Nicht mehr anzeigen</button>
    </p>
  );
}
