"use client";
import { usePathname } from "next/navigation";
import { PAGE_NEEDS, NEEDS, type Banner, type Need } from "@/src/domain/setup";

/**
 * Hinweise auf jeder Admin-Seite, solange der Betrieb nicht live ist (nur Inhaber und Geschäftsführung):
 * eine Zeile zum Stand der Einrichtung und, falls die aktuelle Seite etwas Fehlendes braucht, ein Hinweis mit Link zum passenden Schritt.
 * Nichts wird gesperrt. Auf dem Assistenten selbst bleibt es still.
 */
export function SetupNotices({ home, banner, parallel, unmet }: { home: string; banner: Banner | null; parallel: Banner | null; unmet: Need[] }) {
  const pathname = usePathname();
  const seg = pathname.startsWith(home + "/") ? pathname.slice(home.length + 1).split("/")[0] : "";
  if (seg === "einrichten") return null;
  const need = PAGE_NEEDS[seg];
  const missing = need && unmet.includes(need) ? NEEDS[need] : null;
  if (!banner && !parallel && !missing) return null;
  return (
    <>
      {banner ? (
        <div className={`setup-banner ${banner.kind}`} role="status">
          <span>{banner.text}</span>
          <a className="btn small" href={`${home}/${banner.path}`}>{banner.cta}</a>
        </div>
      ) : null}
      {parallel ? (
        <div className="setup-banner parallel" role="status">
          <span>{parallel.text}</span>
          <a className="btn small" href={`${home}/${parallel.path}`}>{parallel.cta}</a>
        </div>
      ) : null}
      {missing ? (
        <p className="notice setup-need">{missing.text} <a href={`${home}/einrichten?step=${missing.step}`}>Jetzt erledigen</a></p>
      ) : null}
    </>
  );
}
