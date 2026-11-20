"use client";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { bestMatch, sectionFor, type Nav, type NavItem } from "@/src/admin/nav";

/** Eine Reihe Reiter. Nur der am genauesten passende ist aktiv (sonst leuchten «Rechnungen» und «Rechnungen/Tagesabschluss» zugleich). */
function Row({ tabs, pathname, home, label, sub }: { tabs: NavItem[]; pathname: string; home: string; label: string; sub?: boolean }) {
  const scores = tabs.map((t) => bestMatch(pathname, t, home));
  const top = Math.max(...scores);
  const activeIdx = top > 0 ? scores.indexOf(top) : -1;
  return (
    <nav className={`section-tabs${sub ? " sub" : ""}`} aria-label={label}>
      {tabs.map((t, i) => (
        <Fragment key={t.key}>
          {t.sep && i > 0 ? <span className="tab-sep" aria-hidden="true" /> : null}
          <a href={t.href} className={i === activeIdx ? "active" : undefined} aria-current={i === activeIdx ? "page" : undefined}>{t.label}</a>
        </Fragment>
      ))}
    </nav>
  );
}

/** Reiter über der Seite für zusammengelegte Menüpunkte (z. B. Gäste | Kartei | Posteingang), bei Bedarf mit zweiter Reihe */
export function SectionTabs({ nav, home }: { nav: Nav; home: string }) {
  const pathname = usePathname();
  const section = sectionFor(pathname, nav, home);
  if (!section?.tabs) return null;
  const scores = section.tabs.map((t) => bestMatch(pathname, t, home));
  const active = section.tabs[scores.indexOf(Math.max(...scores))];
  return (
    <>
      <Row tabs={section.tabs} pathname={pathname} home={home} label={section.label} />
      {active?.tabs ? <Row tabs={active.tabs} pathname={pathname} home={home} label={active.label} sub /> : null}
    </>
  );
}
