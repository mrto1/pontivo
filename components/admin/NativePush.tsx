"use client";
import { useEffect, useState } from "react";

type Cap = { Plugins?: { PushNotifications?: {
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: (ev: string, fn: (d: { value?: string }) => void) => Promise<unknown>;
} } };

/**
 * Mitteilungen in der nativen App (SPEC 19.23): nur sichtbar in der App-Hülle (User-Agent «MyPontivoApp»).
 * Meldet die Gerätekennung beim Server an; der Versand über Firebase/Apple folgt, sobald beides eingerichtet ist (mobile/README.md).
 */
export function NativePush({ hotelId }: { hotelId: string }) {
  const [shell, setShell] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { setShell(navigator.userAgent.includes("MyPontivoApp")); }, []);
  if (!shell) return null;
  const enable = async () => {
    const push = (window as unknown as { Capacitor?: Cap }).Capacitor?.Plugins?.PushNotifications;
    if (!push) { setMsg("Mitteilungen sind in dieser App-Version nicht verfügbar."); return; }
    const perm = await push.requestPermissions();
    if (perm.receive !== "granted") { setMsg("Mitteilungen sind in den Geräte-Einstellungen ausgeschaltet."); return; }
    await push.addListener("registration", async (t) => {
      const platform = /android/i.test(navigator.userAgent) ? "android" : "ios";
      const r = await fetch(`/api/admin/hotels/${hotelId}/push/native`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform, token: t.value }) });
      setMsg(r.ok ? "Mitteilungen sind auf diesem Gerät eingeschaltet." : "Anmeldung fehlgeschlagen.");
    });
    await push.register();
  };
  return (
    <div className="stack">
      <button type="button" className="btn secondary small" onClick={enable}>Mitteilungen in der App einschalten</button>
      {msg ? <p className="small">{msg}</p> : null}
    </div>
  );
}
