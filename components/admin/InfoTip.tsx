"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Kleines ⓘ für längere Erklärtexte (statt eines Absatzes unter dem Titel).
 * Antippen oder Klicken öffnet eine Karte direkt darunter, erneut tippen, daneben tippen, ✕ oder Esc schliesst.
 * Funktioniert gleich mit Maus, Touch und Tastatur (echter Knopf, aria-expanded). Die Karte hängt am Seitenende (Portal),
 * damit sie nie vom Titel oder von einer scrollbaren Tabelle abgeschnitten wird, und bleibt innerhalb des Bildschirms.
 * Mit `label` erscheint neben dem Symbol ein Text (für Stellen ohne Titel).
 */
export function InfoTip({ children, label, title }: { children: React.ReactNode; label?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; arrow: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const m = 12;
      const width = Math.min(480, window.innerWidth - 2 * m);
      const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, m), window.innerWidth - width - m);
      setPos({ left: left + window.scrollX, top: r.bottom + window.scrollY + 10, width, arrow: Math.min(Math.max(r.left + r.width / 2 - left, 18), width - 18) });
    };
    place();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className={`info-btn${label ? " with-label" : ""}${open ? " on" : ""}`} aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label ?? title ?? "Erklärung anzeigen"} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.6" r=".6" fill="currentColor" /></svg>
        {label ? <span>{label}</span> : null}
      </button>
      {open && pos ? createPortal(
        <div ref={panel} id={id} role="region" aria-label={title ?? label ?? "Erklärung"} className="info-panel" style={{ left: pos.left, top: pos.top, width: pos.width, ["--arrow-x" as string]: `${pos.arrow}px` }}>
          <button type="button" className="info-close" aria-label="Schliessen" onClick={() => { setOpen(false); btn.current?.focus(); }}>✕</button>
          {title ? <strong className="info-title">{title}</strong> : null}
          <div className="info-body">{children}</div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
