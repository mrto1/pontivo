"use client";
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void> };

/** App auf dem Gerät installieren (PWA). Zeigt je nach Gerät den Knopf oder eine Anleitung. */
export function InstallApp() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [state, setState] = useState<"loading" | "installed" | "ios" | "other">("loading");
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const native = navigator.userAgent.includes("MyPontivoApp");
    setState(standalone || native ? "installed" : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "other");
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (state === "loading") return null;
  if (state === "installed") return <p className="small">✓ Sie nutzen Pontivo bereits als App.</p>;
  return (
    <div className="stack">
      {install ? <div><button type="button" className="btn secondary small" onClick={() => install.prompt().then(() => setInstall(null))}>Als App installieren</button></div> : null}
      {state === "ios" ? <p className="muted small">iPhone/iPad: Teilen-Symbol antippen, dann «Zum Home-Bildschirm».</p> : null}
      {!install && state === "other" ? <p className="muted small">Am Handy: Browser-Menü, dann «App installieren» bzw. «Zum Startbildschirm». Am Computer: Installations-Symbol in der Adressleiste (Chrome/Edge).</p> : null}
      <p className="muted small">Die App öffnet sich ohne Browserleiste und ist Voraussetzung für Mitteilungen auf dem iPhone.</p>
    </div>
  );
}
