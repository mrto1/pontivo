"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ASK = "Ungespeicherte Änderungen gehen verloren. Trotzdem schliessen?";

/**
 * Seitenleiste: Escape schliesst, die Seite dahinter scrollt nicht mit, der Fokus geht in die Leiste.
 * Wurde in einem Feld etwas geändert und nicht gespeichert, fragt jedes Verlassen (Esc, ✕, Hintergrund,
 * Abbrechen, Reiter, Karte) vorher nach; Speichern (Absenden) zählt nicht als Verlassen.
 */
export function DrawerKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    let dirty = false;
    // am Dokument statt am Element: die Leiste wird bei jedem Reiterwechsel neu gerendert
    const inDrawer = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.(".drawer-wrap");
    const onInput = (e: Event) => { if (inDrawer(e.target)) dirty = true; };
    const onSubmit = (e: Event) => { if (inDrawer(e.target)) dirty = false; };
    const onClick = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || !inDrawer(a)) return;
      if (!confirm(ASK)) { e.preventDefault(); e.stopPropagation(); } else dirty = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dirty && !confirm(ASK)) return;
      dirty = false;
      router.push(closeHref, { scroll: false });
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener("input", onInput);
    addEventListener("submit", onSubmit);
    addEventListener("click", onClick, true);
    addEventListener("keydown", onKey);
    addEventListener("beforeunload", onUnload);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>(".drawer")?.focus();
    return () => {
      removeEventListener("input", onInput); removeEventListener("submit", onSubmit); removeEventListener("click", onClick, true);
      removeEventListener("keydown", onKey); removeEventListener("beforeunload", onUnload); document.body.style.overflow = prev;
    };
  }, [closeHref, router]);
  return null;
}
