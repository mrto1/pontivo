import crypto from "node:crypto";

/** Hash-Kette der Bons (nur Server: braucht node:crypto). Siehe src/domain/pos.ts. */
export const GENESIS_HASH = "0".repeat(64);

// ---------------------------------------------------------------- Hash-Kette

export type ChainRecord = {
  hotelId: string; number: string; seq: number; kind: string; reversesReceiptId: string | null;
  items: unknown; totalRappen: number; vat: unknown; tipRappen: number; businessDay: string; cashier: string; paidAt: string;
};

/** Festes Feldreihenfolge-Format, damit derselbe Bon immer denselben Hash ergibt */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}
/** Schlüssel sortiert, weil jsonb in Postgres die Reihenfolge ändert */
export function canonical(r: ChainRecord): string {
  return JSON.stringify(stable([r.hotelId, r.number, r.seq, r.kind, r.reversesReceiptId, r.items, r.totalRappen, r.vat, r.tipRappen, r.businessDay, r.cashier, r.paidAt]));
}
export const hashReceipt = (prevHash: string, r: ChainRecord) => crypto.createHash("sha256").update(prevHash).update("|").update(canonical(r)).digest("hex");

/** Kette prüfen: gibt die Nummer (seq) des ersten fehlerhaften Bons zurück, sonst null */
export function verifyChain(rs: (ChainRecord & { prevHash: string; hash: string })[]): number | null {
  let prev = GENESIS_HASH;
  const sorted = [...rs].sort((a, b) => a.seq - b.seq);
  for (const r of sorted) {
    if (r.prevHash !== prev || hashReceipt(prev, r) !== r.hash) return r.seq;
    prev = r.hash;
  }
  return null;
}
