import { readFileSync } from "node:fs";
import { MODULES } from "../domain/modules";
import { allPagesBoth } from "../admin/nav";

/** Erzeugt die Übersicht «Modul → Seiten → Tabellen → SPEC-Abschnitt» (docs/MODULES.md) aus Code und SPEC. Nichts davon wird von Hand gepflegt. */
export function moduleIndex(specPath = "docs/SPEC.md", schemaPath = "src/db/schema.ts"): string {
  const spec = readFileSync(specPath, "utf8");
  const tables = new Set([...readFileSync(schemaPath, "utf8").matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
  // Abschnitte der SPEC: Überschrift «### x.y Titel» bis zur nächsten
  const parts = spec.split(/^(?=#{2,3} )/m).map((t) => ({ head: t.split("\n")[0], body: t }));
  const pages = allPagesBoth({ id: "H", propertyType: "hotel" } as never);
  const rows = MODULES.map((m) => {
    const secs = parts.filter((p) => p.head.includes(`\`${m.key}\``) || new RegExp(`Modul[^\\n]{0,40}\`${m.key}\``).test(p.head));
    const refs = secs.map((s) => s.head.replace(/^#+\s*/, "").match(/^[\d.]+/)?.[0]).filter(Boolean);
    const used = new Set<string>();
    for (const s of secs) for (const t of s.body.matchAll(/`([a-z][a-z_]+)`/g)) if (tables.has(t[1]) && t[1] !== "audit_log") used.add(t[1]);
    const hrefs = m.navKeys.flatMap((k) => pages.filter((p) => p.key === k).map((p) => p.href.replace(/^\/admin\/H\/?/, "") || "(Start)"));
    return `| \`${m.key}\` | ${m.label} | ${m.deps.map((d) => `\`${d}\``).join(", ") || "–"} | ${m.defaultOn ? "an" : "aus"} | ${[...new Set(hrefs)].map((h) => `\`${h}\``).join(", ") || "–"} | ${[...used].sort().map((t) => `\`${t}\``).join(", ") || "–"} | ${[...new Set(refs)].join(", ") || "–"} |`;
  });
  return [
    "# Modulübersicht",
    "",
    "Erzeugt mit `npx tsx scripts/module-index.ts` aus `src/domain/modules.ts`, `src/admin/nav.ts`, `src/db/schema.ts` und `docs/SPEC.md`. Nicht von Hand ändern; `tests/unit/module-index.test.ts` schlägt an, wenn sie veraltet ist.",
    "",
    "Die Spalte «Tabellen» zeigt Tabellen, die in den SPEC-Abschnitten des Moduls genannt sind (kann unvollständig sein); «SPEC» nennt die Abschnitte, deren Überschrift das Modul nennt.",
    "",
    "| Modul | Name | Braucht | Standard | Seiten (unter /admin/<id>/) | Tabellen | SPEC |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
