"use client";

/** Löst eine Rechenaufgabe vom Server (siehe src/lib/pow.ts). Gibt den Beweis `<aufgabe>.<nonce>` zurück. */
export async function solvePow(): Promise<string> {
  const c = (await (await fetch("/api/pow", { cache: "no-store" })).json()) as { token: string; salt: string; bits: number };
  const enc = new TextEncoder();
  const zeroBits = (h: Uint8Array) => { let n = 0; for (const b of h) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
  for (let nonce = 0; ; nonce++) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(c.salt + nonce)));
    if (zeroBits(h) >= c.bits) return `${c.token}.${nonce}`;
    if (nonce % 2000 === 1999) await new Promise((r) => setTimeout(r)); // Browser nicht blockieren
  }
}

let passCache: { pass: string; until: number } | null = null;
let passPending: Promise<string> | null = null;
/** Pass für den Chat (30 Minuten gültig, wird zwischengespeichert). */
export function getPowPass(): Promise<string> {
  if (passCache && passCache.until > Date.now()) return Promise.resolve(passCache.pass);
  return (passPending ??= (async () => {
    try {
      const proof = await solvePow();
      const r = await fetch("/api/pow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof }) });
      const j = (await r.json()) as { pass?: string };
      if (!j.pass) return "";
      passCache = { pass: j.pass, until: Date.now() + 25 * 60_000 };
      return j.pass;
    } catch {
      return "";
    } finally {
      passPending = null;
    }
  })());
}
