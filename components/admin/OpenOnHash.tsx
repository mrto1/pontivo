"use client";
import { useEffect } from "react";

/** Klappt die Karte (<details>) auf, auf die der Adressanker (#rt-…) zeigt, samt allen umgebenden, und scrollt hin. */
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement) n.open = true;
      el.scrollIntoView({ block: "start" });
    };
    open();
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []);
  return null;
}
