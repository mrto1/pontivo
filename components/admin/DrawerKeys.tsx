"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Seitenleiste: Escape schliesst, die Seite dahinter scrollt nicht mit, der Fokus geht in die Leiste */
export function DrawerKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") router.push(closeHref, { scroll: false }); };
    addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>(".drawer")?.focus();
    return () => { removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [closeHref, router]);
  return null;
}
