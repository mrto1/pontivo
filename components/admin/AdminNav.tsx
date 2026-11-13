"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isActive, type Nav, type NavItem } from "@/src/admin/nav";

type InstallEvent = Event & { prompt: () => Promise<void> };

/**
 * Menü: Desktop = Links in der Kopfzeile, Handy = feste Leiste unten. «Mehr» öffnet auf dem Handy ein Fenster von unten,
 * auf dem Desktop ein Menü unter der Kopfzeile. Menüinhalt kommt aus src/admin/nav.ts.
 */
export function AdminNav({ nav, home, userLabel }: { nav: Nav; home: string; userLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) setIosHint(true);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const moreActive = nav.groups.some((g) => g.items.some((i) => isActive(pathname, i, home)));
  const a = (i: NavItem) => (isActive(pathname, i, home) ? "active" : undefined);
  const ext = (i: NavItem) => (i.external ? { target: "_blank", rel: "noopener" } : {});

  return (
    <>
      <nav className="admin-nav" aria-label="Hauptmenü">
        {nav.primary.map((i) => <a key={i.key} href={i.href} className={a(i)} aria-current={isActive(pathname, i, home) ? "page" : undefined}>{i.label}</a>)}
      </nav>
      <button type="button" className={`more-btn${moreActive ? " active" : ""}`} aria-expanded={open} aria-controls="admin-more" onClick={() => setOpen((v) => !v)}>
        Mehr <span aria-hidden>▾</span>
      </button>

      <nav className="tabbar" aria-label="Hauptmenü">
        {nav.primary.map((i) => <a key={i.key} href={i.href} className={a(i)} aria-current={isActive(pathname, i, home) ? "page" : undefined}>{i.label}</a>)}
        <button type="button" className={moreActive || open ? "active" : undefined} aria-expanded={open} aria-controls="admin-more" onClick={() => setOpen((v) => !v)}>Mehr</button>
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
            <div className="more-group">
              <h3>App</h3>
              {install ? <button type="button" className="btn secondary small" onClick={() => install.prompt().then(() => setInstall(null))}>Als App installieren</button> : null}
              {iosHint ? <p className="muted small">Zum Installieren: Teilen-Symbol, dann «Zum Home-Bildschirm».</p> : null}
              <p className="muted small">{userLabel}</p>
              <form action="/api/auth/logout" method="post"><button className="btn secondary small">Abmelden</button></form>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
