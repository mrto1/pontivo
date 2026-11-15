/** Newsletter (SPEC 19.12). Reine Logik: Auswahl der Empfänger. */
export type Recipient = { email: string; language: string; tags: string[]; stays: number; lastStay: string | null };
export type Segment = { language?: string; tag?: string; stayedSince?: string; minStays?: number };

export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Empfänger nach Auswahl filtern (alle Bedingungen müssen zutreffen) */
export function select(all: Recipient[], seg: Segment): Recipient[] {
  return all.filter((r) =>
    (!seg.language || r.language === seg.language) &&
    (!seg.tag || r.tags.includes(seg.tag.toLowerCase())) &&
    (!seg.stayedSince || (r.lastStay !== null && r.lastStay >= seg.stayedSince)) &&
    (!seg.minStays || r.stays >= seg.minStays));
}
