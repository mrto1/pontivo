"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Sprach-Reiter wie im Website-Editor («Bearbeiten: Deutsch und …»), aber im Browser: Deutsch bleibt sichtbar, von den übrigen
 * Sprachen zeigt das Formular nur die gewählte (`[data-lang]`-Elemente im selben Formular). Eingaben bleiben beim Wechsel erhalten.
 */
export function LangTabs({ langs }: { langs: { code: string; name: string }[] }) {
  const [cur, setCur] = useState(langs[0]?.code ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    form?.querySelectorAll<HTMLElement>("[data-lang]").forEach((e) => { e.hidden = e.dataset.lang !== cur; });
  }, [cur]);
  if (!langs.length) return null;
  return (
    <div ref={ref} className="lang-tabs" role="tablist" aria-label="Sprache bearbeiten">
      <span className="small muted">Bearbeiten: Deutsch und</span>
      {langs.map((l) => <button key={l.code} type="button" role="tab" aria-selected={l.code === cur} className={l.code === cur ? "active" : undefined} onClick={() => setCur(l.code)}>{l.name}</button>)}
    </div>
  );
}
