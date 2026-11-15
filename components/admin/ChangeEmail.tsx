"use client";
import { useState } from "react";

const TEXT: Record<string, string> = {
  invalid: "Das ist keine gültige E-Mail-Adresse.",
  same: "Das ist bereits Ihre aktuelle Adresse.",
  disposable: "Wegwerf-Adressen sind nicht erlaubt.",
  code: "Der Code der Authenticator-App stimmt nicht.",
  rate: "Zu viele Versuche. Bitte später erneut versuchen.",
};

/** E-Mail-Adresse ändern: Bestätigungslink geht an die neue Adresse, Hinweis an die alte. */
export function ChangeEmail({ current, needsCode }: { current: string; needsCode: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await fetch("/api/account/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }) });
    const j = await r.json().catch(() => ({}));
    if (j.result === "sent") setSent(true);
    else setMsg(TEXT[j.result] ?? "Das hat nicht geklappt.");
  }
  if (sent) return <p className="notice" role="status">Wir haben einen Bestätigungslink an {email} geschickt (60 Minuten gültig). Ihre bisherige Adresse bleibt bis zur Bestätigung gültig und wird ebenfalls informiert.</p>;
  if (!open) return <button type="button" className="btn secondary small" onClick={() => setOpen(true)}>E-Mail-Adresse ändern</button>;
  return (
    <form onSubmit={submit} className="stack" style={{ maxWidth: 420 }}>
      <label>Neue E-Mail-Adresse<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="neu@beispiel.ch" /></label>
      {needsCode ? <label>Code der Authenticator-App<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label> : null}
      <p className="muted small">Aktuell: {current}. Der Link zur Bestätigung geht an die neue Adresse.</p>
      {msg ? <p className="error" role="alert">{msg}</p> : null}
      <div className="inline-form"><button className="btn small">Link senden</button><button type="button" className="btn secondary small" onClick={() => setOpen(false)}>Abbrechen</button></div>
    </form>
  );
}
