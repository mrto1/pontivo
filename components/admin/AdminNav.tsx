"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isActive, type Nav, type NavItem } from "@/src/admin/nav";

/**
 * Menü: Desktop = Links in der Kopfzeile, Handy = feste Leiste unten. «Mehr» öffnet auf dem Handy ein Fenster von unten,
 * auf dem Desktop ein Menü unter der Kopfzeile. Menüinhalt kommt aus src/admin/nav.ts.
 * Das Profilbild (Initialen) oben rechts führt zu «Mein Konto» (Konto, App, Sicherheit; «myPontivo» heisst der ganze Admin-Bereich).
 */
export function AdminNav({ nav, home, userLabel, initials }: { nav: Nav; home: string; userLabel: string; initials: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hasMore = nav.groups.length > 0;
  const mypontivo = `${home}/mypontivo`;
  const myActive = pathname === mypontivo;
  const moreActive = nav.groups.some((g) => g.items.some((i) => isActive(pathname, i, home)));
  const a = (i: NavItem) => (isActive(pathname, i, home) ? "active" : undefined);
  const ext = (i: NavItem) => (i.external ? { target: "_blank", rel: "noopener" } : {});

  return (
    <>
      <nav className="admin-nav" aria-label="Hauptmenü">
        {nav.primary.map((i) => <a key={i.key} href={i.href} className={a(i)} aria-current={isActive(pathname, i, home) ? "page" : undefined}>{i.label}</a>)}
      </nav>
      {hasMore ? (
        <button type="button" className={`more-btn${moreActive ? " active" : ""}`} aria-expanded={open} aria-controls="admin-more" onClick={() => setOpen((v) => !v)}>
          Mehr <span aria-hidden>▾</span>
        </button>
      ) : null}
      <a href={mypontivo} className={`avatar-link${myActive ? " active" : ""}`} aria-current={myActive ? "page" : undefined} aria-label={`Mein Konto (${userLabel})`} title={userLabel}>{initials}</a>

      <nav className="tabbar" aria-label="Hauptmenü">
        {nav.primary.map((i) => <a key={i.key} href={i.href} className={a(i)} aria-current={isActive(pathname, i, home) ? "page" : undefined}>{i.label}</a>)}
        {hasMore ? <button type="button" className={moreActive || open ? "active" : undefined} aria-expanded={open} aria-controls="admin-more" onClick={() => setOpen((v) => !v)}>Mehr</button> : null}
      </nav>

      {open ? (
        <>
          <div className="more-backdrop" onClick={() => setOpen(false)} />
          <div id="admin-more" className="more-panel" role="dialog" aria-label="Weitere Seiten">
            {nav.groups.map((g) => (
              <div key={g.title} className="more-group">
                <h3>{g.title}</h3>
                {g.items.map((i) => <a key={i.key} href={i.href} className={a(i)} {...ext(i)}>{i.label}{i.external ? " ↗" : ""}</a>)}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
