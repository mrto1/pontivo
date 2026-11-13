"use client";
import { usePathname } from "next/navigation";
import { sectionFor, type Nav } from "@/src/admin/nav";

/** Reiter über der Seite für zusammengelegte Menüpunkte (z. B. Gäste | Anfragen | Gutscheine) */
export function SectionTabs({ nav, home }: { nav: Nav; home: string }) {
  const pathname = usePathname();
  const section = sectionFor(pathname, nav, home);
  if (!section?.tabs) return null;
  return (
    <nav className="section-tabs" aria-label={section.label}>
      {section.tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return <a key={t.key} href={t.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{t.label}</a>;
      })}
    </nav>
  );
}
