"use client";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { rememberPasskey } from "./PasskeyLogin";

type Pk = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("de-CH") : "noch nie");

export function AccountSecurity({ passkeys, totpOn, codesLeft, passkeyOnly, passwordSet }: { passkeys: Pk[]; totpOn: boolean; codesLeft: number; passkeyOnly: boolean; passwordSet: boolean }) {
  const [pks, setPks] = useState(passkeys);
  const [on, setOn] = useState(totpOn);
  const [left, setLeft] = useState(codesLeft);
  const [only, setOnly] = useState(passkeyOnly);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [hasPw, setHasPw] = useState(passwordSet);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function addPasskey() {
    setMsg("");
    try {
      const o = await post("/api/account/passkey", { action: "options" });
      const response = await startRegistration({ optionsJSON: o.data });
      const v = await post("/api/account/passkey", { action: "verify", response, name: name || "Passkey" });
      if (!v.ok) throw new Error("verify");
      rememberPasskey();
      window.location.reload();
    } catch { setMsg("Passkey konnte nicht angelegt werden (abgebrochen oder nicht unterstützt)."); }
  }
  async function removePasskey(id: string) {
    if (!confirm("Diesen Passkey entfernen?")) return;
    const r = await post("/api/account/passkey", { action: "delete", id });
    if (r.data.ok) setPks(pks.filter((p) => p.id !== id));
    else setMsg("Bei «nur Passkey» müssen mindestens 2 Passkeys bleiben. Schalten Sie zuerst Passwort und E-Mail-Link wieder ein.");
  }
  async function toggleOnly(disabled: boolean) {
    setMsg("");
    const r = await post("/api/account/passkey", { action: "emailLogin", disabled });
    if (r.ok) setOnly(disabled); else setMsg("Dafür braucht es mindestens 2 Passkeys (ein Ersatzgerät, damit Sie nicht ausgesperrt sind).");
  }
  async function savePassword() {
    setPwMsg(null);
    const r = await post("/api/account/password", { current: curPw, password: newPw });
    if (r.ok) { setHasPw(true); setCurPw(""); setNewPw(""); setPwMsg({ ok: true, text: "Passwort gespeichert." }); }
    else setPwMsg({ ok: false, text: r.data.error ?? "Das Passwort konnte nicht gespeichert werden." });
  }
  async function begin() {
    setMsg("");
    const r = await post("/api/account/totp", { action: "begin" });
    if (r.ok) { setSetup({ secret: r.data.secret, qr: r.data.qr }); setCode(""); } else setMsg(r.data.error ?? "Fehler");
  }
  async function confirm2() {
    const r = await post("/api/account/totp", { action: "confirm", code });
    if (r.ok) { setOn(true); setSetup(null); setRecovery(r.data.recoveryCodes); setLeft(r.data.recoveryCodes.length); setCode(""); setMsg(""); }
    else setMsg("Der Code stimmt nicht. Bitte den aktuellen Code der App eingeben.");
  }
  async function disable() {
    const r = await post("/api/account/totp", { action: "disable", code });
    if (r.ok) { setOn(false); setCode(""); setRecovery(null); setMsg("Authenticator-App ausgeschaltet."); } else setMsg("Der Code stimmt nicht.");
  }
  async function regenerate() {
    const r = await post("/api/account/totp", { action: "regenerate", code });
    if (r.ok) { setRecovery(r.data.recoveryCodes); setLeft(r.data.recoveryCodes.length); setCode(""); setMsg(""); } else setMsg("Der Code stimmt nicht.");
  }

  return (
    <div className="stack">
      {msg ? <p className="notice warn">{msg}</p> : null}

      <section className="card stack">
        <h2>Passwort</h2>
        <p className="muted small">{hasPw ? "Sie melden sich mit E-Mail und Passwort an." : "Sie haben noch kein Passwort. Setzen Sie eines, dann melden Sie sich mit E-Mail und Passwort an (bisher: Login-Link per E-Mail)."} Eine Authenticator-App (unten) schützt das Passwort zusätzlich.</p>
        {pwMsg ? <p className={pwMsg.ok ? "notice" : "notice warn"} role="status">{pwMsg.text}</p> : null}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); savePassword(); }}>
          {hasPw ? <div><label htmlFor="pw-cur">Aktuelles Passwort</label><input id="pw-cur" type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required /></div> : null}
          <div><label htmlFor="pw-new">{hasPw ? "Neues Passwort" : "Passwort"} (mindestens 8 Zeichen)</label><input id="pw-new" type="password" autoComplete="new-password" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} required data-testid="pw-new" /></div>
          <div><button className="btn" type="submit" data-testid="pw-save">{hasPw ? "Passwort ändern" : "Passwort setzen"}</button></div>
        </form>
      </section>

      <section className="card stack">
        <h2>Passkeys</h2>
        <p className="muted small">Anmelden mit Fingerabdruck, Gesicht oder Gerätecode, ohne Passwort einzutippen. Passkey und Passwort sind gleichwertige Anmeldewege.</p>
        {pks.length ? (
          <ul>
            {pks.map((p) => (
              <li className="u-d-flex u-gap-12px u-ai-center u-jc-space-between" key={p.id}>
                <span><strong>{p.name}</strong> <span className="muted small">angelegt {fmt(p.createdAt)}, zuletzt {fmt(p.lastUsedAt)}</span></span>
                <button className="btn secondary small" onClick={() => removePasskey(p.id)}>Entfernen</button>
              </li>
            ))}
          </ul>
        ) : <p className="small">Noch kein Passkey.</p>}
        <div className="flex-wrap8">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. «iPhone von Ruth»" maxLength={60} aria-label="Name des Passkeys" />
          <button className="btn" onClick={addPasskey} data-testid="passkey-add">Passkey hinzufügen</button>
        </div>
        <div className="stack">
          <p><strong>Anmeldung nur per Passkey:</strong> {only ? "eingeschaltet. Passwort und E-Mail-Link funktionieren für Ihr Konto nicht mehr." : "ausgeschaltet. Passwort und E-Mail-Link funktionieren weiterhin."}</p>
          <p className="muted small">Sicherste Einstellung (schützt vor Phishing und Postfach-Übernahme). Braucht mindestens 2 Passkeys, z. B. Handy und Laptop oder ein Passwort-Manager. Bei Verlust aller Passkeys muss Pontivo Ihr Konto zurücksetzen.</p>
          <div>{only
            ? <button className="btn secondary small" onClick={() => toggleOnly(false)}>Passwort und E-Mail-Link wieder erlauben</button>
            : <button className="btn secondary small" onClick={() => toggleOnly(true)} disabled={pks.length < 2}>Nur Passkey erlauben{pks.length < 2 ? " (erst 2 Passkeys anlegen)" : ""}</button>}</div>
        </div>
      </section>

      <section className="card stack">
        <h2>Zwei-Faktor-Anmeldung (Authenticator-App)</h2>
        <p className="muted small">Optional. Bei jeder Anmeldung (Passwort, Passkey oder E-Mail-Link) fragen wir zusätzlich den 6-stelligen Code einer App wie Google Authenticator, Microsoft Authenticator, 2FAS oder Aegis ab.</p>
        {!on && !setup ? <div><button className="btn" onClick={begin}>Authenticator-App einrichten</button></div> : null}
        {setup ? (
          <div className="stack">
            <p>1. QR-Code mit der App scannen (oder den Schlüssel von Hand eingeben):</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR-Code für die Authenticator-App" width={220} height={220} />
            <p className="small">Schlüssel: <code>{setup.secret}</code></p>
            <p>2. Den angezeigten 6-stelligen Code eingeben:</p>
            <div className="u-d-flex gap8">
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="Code" data-testid="totp-code" />
              <button className="btn" onClick={confirm2} data-testid="totp-confirm">Bestätigen und aktivieren</button>
            </div>
          </div>
        ) : null}
        {on ? (
          <div className="stack">
            <p><strong>Aktiv.</strong> Noch {left} Wiederherstellungscodes übrig.</p>
            <p className="small muted">Zum Ausschalten oder für neue Wiederherstellungscodes einen gültigen Code (App oder Wiederherstellungscode) eingeben:</p>
            <div className="flex-wrap8">
              <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" aria-label="Code" />
              <button className="btn secondary" onClick={regenerate}>Neue Wiederherstellungscodes</button>
              <button className="btn secondary" onClick={disable}>Ausschalten</button>
            </div>
          </div>
        ) : null}
        {recovery ? (
          <div className="notice warn stack" data-testid="recovery-codes">
            <strong>Wiederherstellungscodes. Jetzt sicher aufbewahren, sie werden nur einmal angezeigt.</strong>
            <p className="small">Jeder Code gilt einmal, falls Sie Ihr Handy verlieren.</p>
            <pre>{recovery.join("\n")}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
