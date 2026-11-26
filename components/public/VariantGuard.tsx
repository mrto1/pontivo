"use client";
import { useEffect, useRef } from "react";

/**
 * Macht Pflicht-Optionen einer Variante (z. B. Garstufe) im Browser zur Pflicht, sobald die Variante benutzt wird (Anzahl > 0 oder etwas gewählt).
 * Unbenutzte Varianten bleiben frei. Der Server prüft unabhängig davon (`checkChoice`).
 */
export function VariantGuard() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = ref.current?.closest("fieldset");
    if (!box) return;
    const qty = box.querySelector<HTMLInputElement>("input[type=number]");
    const req = Array.from(box.querySelectorAll<HTMLSelectElement>("select[data-required]"));
    const others = Array.from(box.querySelectorAll<HTMLInputElement | HTMLSelectElement>("select:not([data-required]), input[type=checkbox], input:not([type])"));
    const update = () => {
      const used = Number(qty?.value || 0) > 0 || req.some((s) => s.value) || others.some((e) => (e instanceof HTMLInputElement && e.type === "checkbox" ? e.checked : !!e.value));
      for (const s of req) s.required = used;
    };
    box.addEventListener("input", update);
    box.addEventListener("change", update);
    update();
    return () => { box.removeEventListener("input", update); box.removeEventListener("change", update); };
  }, []);
  return <span ref={ref} hidden />;
}
