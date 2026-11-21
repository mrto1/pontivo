"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Info = { deviceKey: string; battery: number | null; charging: boolean | null; soundOk: boolean; label: string };
type Battery = { level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void };
type WakeLock = { release: () => Promise<void> };

function deviceKey() {
  try {
    const k = localStorage.getItem("pv_order_screen");
    if (k && /^[A-Za-z0-9_-]{8,64}$/.test(k)) return k;
    const n = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem("pv_order_screen", n);
    return n;
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
}

/**
 * Bestellbildschirm (SPEC 20.4, Konzept Abschnitt 7): Selbstprüfung beim Start (Ton, Akku, Ladekabel, Bildschirm bleibt an),
 * Herzschlag jede Minute, Dauerton solange neue Bestellungen warten, lädt alle 10 Sekunden neu.
 */
export function OrderScreen({ waiting, beat, probe }: { waiting: number; beat: (i: Info) => Promise<void>; probe: boolean }) {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [asked, setAsked] = useState(false);
  const [soundOk, setSoundOk] = useState(false);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [wake, setWake] = useState<"on" | "off" | "na">("na");
  const ctx = useRef<AudioContext | null>(null);
  const lock = useRef<WakeLock | null>(null);
  const key = useRef("");

  const tone = useCallback((ms = 350) => {
    const c = ctx.current;
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "square"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.25, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + ms / 1000);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + ms / 1000);
  }, []);

  const keepAwake = useCallback(async () => {
    const n = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } };
    if (!n.wakeLock) { setWake("na"); return; }
    try { lock.current = await n.wakeLock.request("screen"); setWake("on"); } catch { setWake("off"); }
  }, []);

  const send = useCallback(() => {
    if (!key.current) return;
    beat({ deviceKey: key.current, battery: battery ? Math.round(battery.level * 100) : null, charging: battery ? battery.charging : null, soundOk, label: navigator.platform || "" }).catch(() => {});
  }, [beat, battery, soundOk]);

  // Akku lesen (nicht jeder Browser kann das)
  useEffect(() => {
    const n = navigator as Navigator & { getBattery?: () => Promise<Battery> };
    if (!n.getBattery) return;
    n.getBattery().then((b) => {
      const upd = () => setBattery({ level: b.level, charging: b.charging });
      upd(); b.addEventListener("levelchange", upd); b.addEventListener("chargingchange", upd);
    }).catch(() => {});
  }, []);

  // Herzschlag jede Minute, sobald gestartet
  useEffect(() => {
    if (!started) return;
    send();
    const id = setInterval(send, 60_000);
    return () => clearInterval(id);
  }, [started, send]);

  // Neu laden alle 10 Sekunden
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [router]);

  // Dauerton, solange neue Bestellungen warten
  useEffect(() => {
    if (!started || waiting === 0) return;
    tone(); const id = setInterval(() => tone(), 1500);
    return () => clearInterval(id);
  }, [started, waiting, tone]);

  // Bildschirm wieder wach halten, wenn die Seite zurückkommt
  useEffect(() => {
    if (!started) return;
    const v = () => { if (document.visibilityState === "visible") { keepAwake(); send(); } };
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, [started, keepAwake, send]);

  async function start() {
    key.current = deviceKey();
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC) { ctx.current = new AC(); await ctx.current.resume().catch(() => {}); }
    tone(600);
    await keepAwake();
    setAsked(true);
  }

  const warnings: string[] = [];
  if (battery && battery.level < 0.2 && !battery.charging) warnings.push(`Akku ${Math.round(battery.level * 100)} %: bitte sofort ans Ladekabel.`);
  else if (battery && !battery.charging) warnings.push("Das Gerät lädt nicht. Für den Betrieb bitte ans Ladekabel.");
  if (wake === "off") warnings.push("Der Bildschirm kann ausgehen. Bitte in den Geräte-Einstellungen die automatische Sperre ausschalten.");
  if (started && !soundOk) warnings.push("Ton nicht bestätigt: Lautstärke prüfen, sonst überhören Sie Bestellungen.");

  if (!started) {
    return (
      <div className="card stack" data-testid="order-selfcheck" role="dialog" aria-label="Selbstprüfung">
        <h2>Bestellbildschirm starten</h2>
        {!asked ? (
          <>
            <p>Bevor Bestellungen hier ankommen, prüfen wir kurz das Gerät: Ton, Akku und ob der Bildschirm an bleibt.{probe ? " Danach erscheint Ihre Probebestellung." : ""}</p>
            <div><button className="btn" onClick={start}>Prüfung starten</button></div>
          </>
        ) : (
          <>
            <p><strong>Haben Sie den Ton gehört?</strong></p>
            <div className="inline-form">
              <button className="btn" onClick={() => { setSoundOk(true); setStarted(true); }}>Ja, gehört</button>
              <button className="btn secondary" onClick={() => tone(600)}>Nochmals abspielen</button>
              <button className="btn secondary" onClick={() => { setSoundOk(false); setStarted(true); }}>Nein, trotzdem starten</button>
            </div>
            <p className="small muted">Kein Ton? Lautstärke hochdrehen und Stummschaltung aufheben.</p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="stack" data-testid="order-screen-status">
      {warnings.map((w) => <p key={w} className="badge warn" role="alert">{w}</p>)}
      <p className="small muted">Bildschirm aktiv{battery ? ` · Akku ${Math.round(battery.level * 100)} %${battery.charging ? " (lädt)" : ""}` : ""}{wake === "on" ? " · bleibt an" : ""}. Neue Bestellungen klingeln, bis Sie sie annehmen.</p>
    </div>
  );
}
