"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Einheitliche Kurzinfo statt Browser-Tooltip. Jedes Element mit `data-tip` bekommt sie:
 *  - `data-tip-title` (optional): Titelzeile
 *  - `data-tip`: Zeilen durch «\n» getrennt; «Beschriftung\tWert» ergibt eine Zeile mit Wert rechts, sonst Fliesstext
 * Maus: beim Darüberfahren. Touch: Antippen zeigt, Antippen daneben schliesst. Tastatur: bei Fokus (Element mit tabindex).
 * Ein einziger Host im Layout, die Seiten setzen nur Attribute (keine Hover-Logik pro Seite).
 */
type Tip = { title: string; rows: { label: string; value: string }[]; x: number; y: number; below: boolean; tone: string };

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const find = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null);
    const show = (el: HTMLElement) => {
      current.current = el;
      const r = el.getBoundingClientRect();
      const rows = (el.dataset.tip ?? "").split("\n").filter(Boolean).map((l) => { const [label, ...v] = l.split("\t"); return v.length ? { label, value: v.join("\t") } : { label: l, value: "" }; });
      setTip({ title: el.dataset.tipTitle ?? "", rows, x: r.left + r.width / 2, y: r.top, below: false, tone: el.dataset.tipTone ?? "" });
      // Unterkante merken, falls oben kein Platz ist (nach dem Messen in der Layout-Phase unten)
      el.dataset.tipBottom = String(r.bottom);
    };
    const hide = () => { current.current = null; setTip(null); };
    const over = (e: PointerEvent) => { if (e.pointerType === "mouse") { const el = find(e.target); if (el) show(el); else if (current.current) hide(); } };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const el = find(e.target);
      if (el && el !== current.current) show(el); else hide();
    };
    const focus = (e: FocusEvent) => { const el = find(e.target); if (el) show(el); };
    const blur = () => hide();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    const leave = () => hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerdown", down);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", leave, true);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", leave, true);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  // Nach dem Rendern: im sichtbaren Bereich halten, oben kein Platz → darunter anzeigen
  useEffect(() => {
    const b = box.current;
    if (!tip || !b) return;
    const w = b.offsetWidth, h = b.offsetHeight, m = 8;
    const left = Math.min(Math.max(tip.x - w / 2, m), window.innerWidth - w - m);
    const bottom = Number(current.current?.dataset.tipBottom ?? tip.y);
    const below = tip.y - h - 10 < m;
    b.style.left = `${left}px`;
    b.style.top = `${below ? bottom + 10 : tip.y - h - 10}px`;
    b.style.setProperty("--arrow-x", `${Math.min(Math.max(tip.x - left, 14), w - 14)}px`);
    b.dataset.below = below ? "1" : "0";
    b.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className={`tt${tip.tone ? ` tt-${tip.tone}` : ""}`} role="tooltip" style={{ visibility: "hidden", left: 0, top: 0 }}>
      {tip.title ? <div className="tt-title">{tip.title}</div> : null}
      {tip.rows.map((r, i) => r.value
        ? <div key={i} className={`tt-row${i === 0 ? " tt-main" : ""}`}><span>{r.label}</span><strong>{r.value}</strong></div>
        : <div key={i} className="tt-text">{r.label}</div>)}
    </div>
  );
}
