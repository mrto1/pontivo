"use client";
import { useEffect } from "react";

/**
 * Dezente Einblend-Effekte beim Scrollen: Abschnittsinhalte und Kacheln gleiten leicht ein (gestaffelt).
 * Ohne JavaScript oder bei «Bewegung reduzieren» bleibt alles sofort sichtbar.
 */
export function ScrollEffects() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>("[data-pv-page]");
    if (!page || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const targets: HTMLElement[] = [];
    const grids = /(paths|modGrid|steps|benefits|flow|contactLinks)/;
    page.querySelectorAll<HTMLElement>("section").forEach((sec) => {
      if (/hero/.test(sec.className)) return;
      Array.from(sec.children).forEach((child) => {
        const el = child as HTMLElement;
        const kids = Array.from(el.children) as HTMLElement[];
        // Raster, Listen und Fragen (FAQ) gestaffelt, auf allen Plattform-Seiten gleich
        const listy = kids.length > 1 && (getComputedStyle(el).display === "grid" || kids.every((k) => /^(DETAILS|LI|ARTICLE|A)$/.test(k.tagName)));
        if ((grids.test(el.className) || listy) && kids.length > 1) {
          kids.forEach((k, i) => { k.style.setProperty("--d", `${Math.min(i, 6) * 70}ms`); targets.push(k); });
        } else if (/group/.test(el.className)) {
          // Funktionsgruppen: Titel, dann Kacheln gestaffelt
          Array.from(el.children).forEach((c) => {
            const cc = Array.from((c as HTMLElement).children) as HTMLElement[];
            if (/modGrid/.test((c as HTMLElement).className) && cc.length) cc.forEach((k, i) => { k.style.setProperty("--d", `${Math.min(i, 5) * 60}ms`); targets.push(k); });
            else targets.push(c as HTMLElement);
          });
        } else targets.push(el);
      });
    });

    targets.forEach((t) => t.classList.add("pv-r"));
    page.classList.add("pv-js");
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("pv-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    targets.forEach((t) => io.observe(t));
    return () => { io.disconnect(); page.classList.remove("pv-js"); targets.forEach((t) => t.classList.remove("pv-r", "pv-in")); };
  }, []);
  return null;
}
