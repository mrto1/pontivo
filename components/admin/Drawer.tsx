import Link from "next/link";
import { DrawerKeys } from "./DrawerKeys";

/**
 * Seitenleiste für Stammdaten (Bearbeiten und Neu anlegen): Hintergrund, Kopf mit ✕, Tastatur und Fokus.
 * `closeHref`: Adresse der Liste ohne geöffnete Leiste. Der Inhalt (meist ein Formular) kommt als Kinder.
 */
export function Drawer({ title, closeHref, children }: { title: string; closeHref: string; children: React.ReactNode }) {
  return (
    <div className="drawer-wrap">
      <Link className="drawer-backdrop" href={closeHref} scroll={false} aria-label="Schliessen" tabIndex={-1} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
        <header className="drawer-head">
          <h2 id="drawer-title">{title}</h2>
          <Link className="drawer-close" href={closeHref} scroll={false} aria-label="Schliessen">✕</Link>
        </header>
        <div className="drawer-body stack">{children}</div>
      </aside>
      <DrawerKeys closeHref={closeHref} />
    </div>
  );
}

/** Knopfzeile am Ende des Formulars in der Seitenleiste: Hauptknopf und «Abbrechen» */
export function DrawerActions({ submit, cancelHref }: { submit: string; cancelHref: string }) {
  return <div className="drawer-actions"><button className="btn">{submit}</button><Link className="btn secondary" href={cancelHref} scroll={false}>Abbrechen</Link></div>;
}
