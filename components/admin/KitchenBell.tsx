"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Küchenbildschirm (SPEC 20.4): lädt alle 10 Sekunden neu, Ton bei neuen Bons (nach «Ton einschalten») */
export function KitchenBell({ tickets }: { tickets: string[] }) {
  const router = useRouter();
  const ctx = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [on, setOn] = useState(false);
  const beep = () => {
    const c = ctx.current;
    if (!c) return;
    for (const [i, f] of [660, 880].entries()) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(0.25, c.currentTime + i * 0.25); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + i * 0.25 + 0.22);
      o.connect(g).connect(c.destination); o.start(c.currentTime + i * 0.25); o.stop(c.currentTime + i * 0.25 + 0.22);
    }
  };
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [router]);
  useEffect(() => {
    const prev = seen.current;
    seen.current = new Set(tickets);
    if (prev && on && tickets.some((t) => !prev.has(t))) beep();
  }, [tickets, on]);
  return on ? <p className="small muted">Ton an: neue Bons klingeln.</p>
    : <button type="button" className="btn secondary small" onClick={() => { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; if (AC) ctx.current = new AC(); setOn(true); beep(); }}>Ton einschalten</button>;
}
