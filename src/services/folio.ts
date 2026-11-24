import { db } from "../db/client";
import { folioItems, type FolioItem } from "../db/schema";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type FolioItemInput = {
  hotelId: string; bookingId: string; description: string; quantity: number; unitPriceRappen: number;
  vatKind: FolioItem["vatKind"]; createdBy: string;
  /** fester MWST-Satz in Basispunkten, wenn er von der Art abweicht (Restaurant, reduzierter Satz) */
  vatBpsOverride?: number | null;
  /** Herkunft des Postens (z. B. `shop:<id>`, `minibar:<id>`, `pos`) */
  source?: string | null;
  /** Beleg-ID der Herkunft; mit `ignoreConflict` bleibt eine Wiederholung wirkungslos */
  externalId?: string | null;
};

/**
 * Einziger Weg, einen Posten in die Buchung zu schreiben (Rechnung & Kasse, Shop, Minibar, Angebote vor Ort, Kasse, Kassen-Schnittstelle).
 * Prüft nichts Fachliches (das tut der Aufrufer) und schreibt kein Audit; der Aufrufer protokolliert in derselben Transaktion.
 * Mit `ignoreConflict` liefert die Funktion `null`, wenn die externe Beleg-ID schon gebucht ist.
 */
export async function insertFolioItem(tx: Tx, i: FolioItemInput, opts: { ignoreConflict?: boolean } = {}): Promise<FolioItem | null> {
  const q = tx.insert(folioItems).values({
    hotelId: i.hotelId, bookingId: i.bookingId, description: i.description, quantity: i.quantity, unitPriceRappen: i.unitPriceRappen, vatKind: i.vatKind,
    vatBpsOverride: i.vatBpsOverride ?? null, source: i.source ?? null, externalId: i.externalId ?? null, createdBy: i.createdBy,
  });
  const r = await (opts.ignoreConflict ? q.onConflictDoNothing() : q).returning();
  return r[0] ?? null;
}
