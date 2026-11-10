import crypto from "node:crypto";
import { createHotelWithRooms, type HotelSpec, type RoomSpec } from "../src/services/setup";
import { db } from "../src/db/client";
import { inventoryDays } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { addDays, todayIn } from "../src/domain/dates";

export function uid() {
  return crypto.randomBytes(4).toString("hex");
}

export async function makeHotel(over: Partial<HotelSpec> = {}, rooms?: RoomSpec[]) {
  const slug = over.slug ?? `test-${uid()}`;
  return createHotelWithRooms({
    slug,
    name: over.name ?? `Hotel ${slug}`,
    canton: over.canton ?? "GL",
    municipality: over.municipality ?? "Glarus",
    contactEmail: over.contactEmail ?? `${slug}@example.ch`,
    primaryDomain: over.primaryDomain ?? `${slug}.test`,
    status: over.status ?? "live",
    horizonDays: over.horizonDays ?? 120,
    weekendSurchargeRappen: over.weekendSurchargeRappen ?? 0,
    saturdayMinStay: over.saturdayMinStay ?? 1,
    rooms: rooms ?? [
      { name: "Doppelzimmer", roomCount: 3, maxAdults: 2, maxChildren: 2, maxOccupancy: 4, basePriceRappen: 18000 },
    ],
  });
}

/** Ein Datum in n Tagen (Hotelzeit Europe/Zurich) */
export function inDays(n: number) {
  return addDays(todayIn("Europe/Zurich"), n);
}

export async function inv(roomTypeId: string, night: string) {
  const [r] = await db().select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, roomTypeId), eq(inventoryDays.night, night)));
  return r;
}

export const guest = {
  firstName: "Anna",
  lastName: "Muster",
  email: "anna@example.ch",
  phone: "+41 79 000 00 00",
  language: "de" as const,
  notes: null,
  marketingConsent: false,
};

/** Für eigene Test-Zahlungsanbieter: Karten-Methoden der Mindestgebühr (nicht benutzt) */
export const cardStubs = {
  async createCardSetup(): Promise<{ url: string; sessionId: string }> { throw new Error("nicht im Test"); },
  async finishCardSetup(): Promise<{ customerId: string; paymentMethodId: string; label: string }> { throw new Error("nicht im Test"); },
  async chargeSavedCard(): Promise<{ ok: false; paymentIntentId: null; error: string }> { return { ok: false, paymentIntentId: null, error: "nicht im Test" }; },
};
