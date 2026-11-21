"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { areaOfPath, type Area, type Nav } from "@/src/admin/nav";

/**
 * Zwei Bereiche (SPEC 20.1): Unterkunft und Gastronomie. Der Bereich folgt der Seite, wenn sie nur in einem Baum steht
 * (Links aus Mails wechseln so von selbst); geteilte Seiten bleiben im zuletzt gewählten Bereich (Cookie je Person, pro Gerät).
 */
type Ctx = { area: Area; nav: Nav; navs: { lodging: Nav | null; dining: Nav | null }; choose: (a: Area) => void };
const AreaCtx = createContext<Ctx | null>(null);

export function AreaProvider({ navs, initialArea, cookieName, home, marked, children }: { navs: Ctx["navs"]; initialArea: Area; cookieName: string; home: string; marked: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [chosen, setChosen] = useState<Area>(initialArea);
  const fromPath = areaOfPath(pathname, navs, home);
  const want = fromPath ?? chosen;
  const area: Area = navs[want] ? want : navs.lodging ? "lodging" : "dining";
  // Nur eine Seite, die zu einem Bereich gehört, legt ihn fest (geteilte Seiten ändern nichts)
  useEffect(() => {
    if (!fromPath || fromPath === chosen) return;
    setChosen(fromPath);
    try { document.cookie = `${cookieName}=${fromPath}; path=/; max-age=31536000; samesite=lax`; } catch { /* Cookies gesperrt: Bereich gilt nur für diese Sitzung */ }
  }, [fromPath, chosen, cookieName]);
  const value = useMemo<Ctx>(() => ({
    area, navs, nav: (navs[area] ?? navs.lodging ?? navs.dining)!,
    // Wahl im Umschalter: nur merken; die Seite wechselt danach (der Bereich folgt dann der neuen Seite)
    choose: (a) => { try { document.cookie = `${cookieName}=${a}; path=/; max-age=31536000; samesite=lax`; } catch { /* egal */ } },
  }), [area, navs, cookieName]);
  return <AreaCtx.Provider value={value}><div className={marked ? `area-${area}` : undefined}>{children}</div></AreaCtx.Provider>;
}

/** Menü des aktuellen Bereichs; ohne Provider das übergebene Menü */
export function useAreaNav(fallback: Nav): Nav {
  return useContext(AreaCtx)?.nav ?? fallback;
}
export const useArea = () => useContext(AreaCtx);
