"use client";
import { useEffect, useRef } from "react";
import { solvePow } from "./pow-client";

/**
 * Unsichtbare Rechenaufgabe für ein normales HTML-Formular (SPEC 18.11). Beim Laden wird die Aufgabe gelöst und als verstecktes Feld `_pow`
 * eingetragen. Wird früher abgesendet, wartet das Formular, bis die Lösung da ist. Ohne JavaScript lässt sich das Formular nicht absenden.
 */
// ASSUMPTION: Ohne JavaScript lassen sich Anfrage- und Gutscheinformular nicht mehr absenden (Bots ohne JavaScript sollen genau das nicht können).
export function PowField() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    const form = el?.form;
    if (!el || !form) return;
    let done: Promise<void> | null = null;
    const run = () => (done ??= solvePow().then((p) => { el.value = p; }).catch(() => { done = null; }));
    run();
    const onSubmit = (e: SubmitEvent) => {
      if (el.value) return;
      e.preventDefault();
      run()!.then(() => { if (el.value) form.requestSubmit(); });
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);
  return <input ref={input} type="hidden" name="_pow" defaultValue="" />;
}
