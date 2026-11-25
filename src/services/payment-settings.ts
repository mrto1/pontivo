import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, type Hotel } from "../db/schema";
import { audit } from "./audit";

/** SPEC 19.25: Zahlung auf der eigenen Website einbetten (Stripe Checkout eingebettet) oder wie bisher weiterleiten */
export async function setEmbeddedCheckout(hotel: Hotel, on: boolean, actor: string): Promise<void> {
  await setPaymentUi(hotel, on ? "embedded" : "hosted", actor);
}

export type PaymentUi = "hosted" | "embedded" | "element";

/** Wie bezahlt der Gast auf der Pontivo-Website des Hotels? (`ui` hat Vorrang, sonst das ältere Feld `embedded`) */
export function paymentUi(hotel: Pick<Hotel, "content">): PaymentUi {
  const p = hotel.content.payment;
  return p?.ui ?? (p?.embedded ? "embedded" : "hosted");
}

export async function setPaymentUi(hotel: Hotel, ui: PaymentUi, actor: string): Promise<void> {
  await db().update(hotels).set({ content: { ...hotel.content, payment: { ...(hotel.content.payment ?? {}), ui, embedded: ui === "embedded" } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "payment.ui", entity: "hotel", entityId: hotel.id, details: { ui } });
}
