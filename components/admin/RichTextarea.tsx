"use client";

import { useRef } from "react";

type Props = { name: string; defaultValue: string; rows: number; maxLength?: number; label: string };

/**
 * Textfeld mit kleiner Formatierungsleiste. Speichert reinen Text mit einfachen Zeichen
 * (siehe src/domain/richtext.ts), die Website stellt sie formatiert dar.
 */
export function RichTextarea({ name, defaultValue, rows, maxLength, label }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = (fn: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const el = ref.current;
    if (!el) return;
    const r = fn(el.value, el.selectionStart, el.selectionEnd);
    if (maxLength && r.text.length > maxLength) return;
    el.value = r.text;
    el.focus();
    el.setSelectionRange(r.start, r.end);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /** Markierten Text einrahmen; ohne Markierung Platzhalter einfügen und markieren */
  const wrap = (before: string, after: string, placeholder: string) =>
    apply((t, a, b) => {
      const sel = t.slice(a, b) || placeholder;
      return { text: t.slice(0, a) + before + sel + after + t.slice(b), start: a + before.length, end: a + before.length + sel.length };
    });

  /** Jede markierte Zeile mit einem Präfix versehen (Listen, Zwischentitel) */
  const prefixLines = (prefix: (i: number) => string, placeholder: string) =>
    apply((t, a, b) => {
      const lineStart = t.lastIndexOf("\n", a - 1) + 1;
      const nl = t.indexOf("\n", b);
      const lineEnd = nl === -1 ? t.length : nl;
      const block = t.slice(lineStart, lineEnd) || placeholder;
      const lines = block.split("\n").map((l, i) => prefix(i) + l.replace(/^\s*([-•]|\d{1,3}[.)]|#{2,3})\s+/, ""));
      const out = lines.join("\n");
      // Liste/Titel als eigener Absatz: Leerzeile davor, wenn direkt Text vorangeht
      const pre = lineStart > 0 && t[lineStart - 2] !== "\n" && t.slice(0, lineStart).trim() ? "\n" : "";
      return { text: t.slice(0, lineStart) + pre + out + t.slice(lineEnd), start: lineStart + pre.length, end: lineStart + pre.length + out.length };
    });

  const link = () => {
    const url = window.prompt("Adresse des Links (z. B. https://www.glarnerland.ch, oder /restaurant für eine eigene Seite)");
    if (!url) return;
    const href = /^(https?:\/\/|mailto:|tel:|\/)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    wrap("[", `](${href})`, "Linktext");
  };

  const btn = (title: string, onClick: () => void, content: React.ReactNode) => (
    <button type="button" className="fmt-btn" title={title} aria-label={`${title} (${label})`} onClick={onClick}>{content}</button>
  );

  return (
    <div className="rich">
      <div className="fmt-bar" role="toolbar" aria-label={`Formatierung ${label}`}>
        {btn("Fett", () => wrap("**", "**", "fett"), <strong>F</strong>)}
        {btn("Kursiv", () => wrap("*", "*", "kursiv"), <em>K</em>)}
        {btn("Link", link, <span aria-hidden="true">Link</span>)}
        <span className="fmt-sep" />
        {btn("Aufzählung", () => prefixLines(() => "- ", "Punkt"), <span aria-hidden="true">• Liste</span>)}
        {btn("Nummerierte Liste", () => prefixLines((i) => `${i + 1}. `, "Punkt"), <span aria-hidden="true">1. Liste</span>)}
        {btn("Zwischentitel", () => prefixLines(() => "## ", "Zwischentitel"), <span aria-hidden="true">Titel</span>)}
        <span className="fmt-sep" />
        {btn("Farbig hervorheben (Hausfarbe)", () => wrap("==", "==", "hervorgehoben"), <span aria-hidden="true" className="fmt-hl">Farbe</span>)}
        {btn("Unterstrichen (im Web oft mit Link verwechselt)", () => wrap("__", "__", "unterstrichen"), <u>U</u>)}
      </div>
      <textarea ref={ref} name={name} rows={rows} defaultValue={defaultValue} maxLength={maxLength} />
    </div>
  );
}
