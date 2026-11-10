import type { Executor } from "../db/client";
import { channexOutbox } from "../db/schema";

/**
 * SPEC 7.2: Jede Änderung an inventory_days/rates_days schreibt in DERSELBEN Transaktion einen Outbox-Eintrag.
 * date_to ist inklusiv.
 */
export async function enqueueAvailability(ex: Executor, hotelId: string, roomTypeId: string, dateFrom: string, dateTo: string) {
  await ex.insert(channexOutbox).values({ hotelId, kind: "availability", roomTypeId, dateFrom, dateTo });
}

/** Restriktionsfelder wie in der Channex-ARI-API (`rate` steht auch für `rates` je Belegung) */
export const RESTRICTION_FIELDS = ["rate", "min_stay_arrival", "max_stay", "closed_to_arrival", "closed_to_departure", "stop_sell"] as const;
export type RestrictionField = (typeof RESTRICTION_FIELDS)[number];

/** `fields` = nur diese Werte haben sich geändert; weglassen = alle (z. B. Vollabgleich, Tarifeinstellungen) */
export async function enqueueRestrictions(ex: Executor, hotelId: string, ratePlanId: string, dateFrom: string, dateTo: string, fields?: RestrictionField[]) {
  await ex.insert(channexOutbox).values({ hotelId, kind: "restrictions", ratePlanId, dateFrom, dateTo, fields: fields && fields.length ? [...new Set(fields)] : null });
}
