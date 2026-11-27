"use client";
import { useRef } from "react";

/**
 * Knopf, der einen kleinen Rückfrage-Dialog öffnet (z. B. «Ablehnen» mit Grund). Der Inhalt ist ein normales Formular (Server Action);
 * «Abbrechen» und Esc schliessen ohne Änderung. Für folgenreiche Aktionen statt eines Aufklappers, der im Stress offen bleibt.
 */
export function DialogButton({ label, title, className = "btn secondary small", children }: { label: string; title: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="ask-dialog" aria-label={title} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="stack">
          <h2 className="m0">{title}</h2>
          {children}
          <form method="dialog"><button className="btn secondary">Abbrechen</button></form>
        </div>
      </dialog>
    </>
  );
}
