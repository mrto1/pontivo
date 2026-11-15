import { z } from "zod";

/** PosBridge (SPEC 19.15): Anfrage einer fremden Kasse prüfen. Reine Logik. */
export const KEY_PREFIX = "pnt_";

export const folioItemRequest = z.object({
  booking_reference: z.string().trim().min(3).max(40).optional(),
  room_number: z.string().trim().min(1).max(20).optional(),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(-999).max(999).refine((n) => n !== 0, "quantity darf nicht 0 sein").default(1),
  unit_price_rappen: z.number().int().min(-10_000_000).max(10_000_000),
  vat: z.enum(["standard", "stay", "none"]).default("standard"),
  external_id: z.string().trim().min(1).max(100),
}).refine((v) => !!v.booking_reference !== !!v.room_number, { message: "Genau eines von booking_reference oder room_number angeben." });
export type FolioItemRequest = z.infer<typeof folioItemRequest>;

/** Schlüssel aus dem Header «Authorization: Bearer …» */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : null;
}

/** Gleiche Anfrage wie eine gespeicherte? (Wiederholung der Kasse ist erlaubt, ein anderer Inhalt mit gleicher Beleg-ID nicht) */
export function sameItem(a: { description: string; quantity: number; unitPriceRappen: number; vatKind: string }, b: { description: string; quantity: number; unitPriceRappen: number; vatKind: string }) {
  return a.description === b.description && a.quantity === b.quantity && a.unitPriceRappen === b.unitPriceRappen && a.vatKind === b.vatKind;
}
