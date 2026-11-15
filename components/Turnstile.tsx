"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; ready?: (cb: () => void) => void } }
}
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Cloudflare Turnstile im Formular. Legt das Feld «cf-turnstile-response» ins Formular (wird serverseitig geprüft). */
export function Turnstile({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, { sitekey: siteKey, theme: "auto", appearance: "interaction-only" });
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) { s = document.createElement("script"); s.src = SRC; s.async = true; document.head.appendChild(s); }
      s.addEventListener("load", mount);
    }
    return () => { cancelled = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey]);
  return <div ref={box} data-testid="turnstile" />;
}
