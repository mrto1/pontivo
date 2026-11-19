import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, type Hotel } from "../db/schema";
import { audit } from "./audit";

/** SPEC 19.25: Zahlung auf der eigenen Website einbetten (Stripe Checkout eingebettet) oder wie bisher weiterleiten */
export async function setEmbeddedCheckout(hotel: Hotel, on: boolean, actor: string): Promise<void> {
  await db().update(hotels).set({ content: { ...hotel.content, payment: { ...(hotel.content.payment ?? {}), embedded: on } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "payment.embedded", entity: "hotel", entityId: hotel.id, details: { embedded: on } });
}
