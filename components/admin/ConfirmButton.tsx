"use client";

/** Absende-Knopf mit Rückfrage (für Löschen u. ä. in Server-Action-Formularen) */
export function ConfirmButton({ ask, className, children }: { ask: string; className?: string; children: React.ReactNode }) {
  return <button className={className} onClick={(e) => { if (!confirm(ask)) e.preventDefault(); }}>{children}</button>;
}
