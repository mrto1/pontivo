import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, hotels, terminalPayments, terminalReaders, type Hotel, type TerminalPayment, type TerminalReader } from "../db/schema";
import { stripe } from "../integrations/stripe/client";
import { platformFee } from "../domain/pricing";
import { audit } from "./audit";
import { bookingBalance, InvoiceError, recordOnsitePayment } from "./invoicing";

/**
 * Stripe Terminal, servergesteuert (SPEC 18.4). Quelle: Stripe-Doku «Collect card payments» (server-driven) und
 * «Use Terminal with Connect» (Direct Charges): alle Aufrufe mit Stripe-Account-Header des Hotels; Location und Reader
 * gehören dem verbundenen Konto; PaymentIntent mit card_present; Reader-Aktion process_payment_intent.
 */
export const TERMINAL_MAX_RAPPEN = 1_000_000;

const needAccount = (hotel: Hotel) => {
  if (!hotel.stripeAccountId) throw new InvoiceError("Zuerst das Stripe-Konto verbinden (Einstellungen → Zahlungen).");
  return { stripeAccount: hotel.stripeAccountId };
};

export async function listReaders(hotelId: string): Promise<TerminalReader[]> {
  return db().select().from(terminalReaders).where(eq(terminalReaders.hotelId, hotelId)).orderBy(terminalReaders.createdAt);
}

export async function listTerminalPayments(hotelId: string, bookingId?: string, limit = 30): Promise<TerminalPayment[]> {
  const w = bookingId ? and(eq(terminalPayments.hotelId, hotelId), eq(terminalPayments.bookingId, bookingId)) : eq(terminalPayments.hotelId, hotelId);
  return db().select().from(terminalPayments).where(w).orderBy(desc(terminalPayments.createdAt)).limit(limit);
}

/** Lesegerät mit dem Registrierungscode des Geräts beim Konto des Hotels anmelden (legt bei Bedarf die Location an) */
export async function registerReader(hotel: Hotel, input: { registrationCode: string; label: string }, actor: string): Promise<TerminalReader> {
  const opts = needAccount(hotel);
  const code = input.registrationCode.trim();
  const label = input.label.trim().slice(0, 60) || "Empfang";
  if (!code) throw new InvoiceError("Bitte den Registrierungscode vom Gerät eingeben.");
  if (!hotel.addressLine || !hotel.postalCode || !hotel.city) throw new InvoiceError("Für das Kartenterminal braucht der Betrieb eine vollständige Adresse (Einstellungen).");
  const existing = (await listReaders(hotel.id))[0];
  let location = existing?.stripeLocationId;
  if (!location) {
    const loc = await stripe().terminal.locations.create(
      { display_name: hotel.name.slice(0, 100), address: { line1: hotel.addressLine, city: hotel.city, postal_code: hotel.postalCode, country: "CH" } },
      opts,
    );
    location = loc.id;
  }
  let reader;
  try {
    reader = await stripe().terminal.readers.create({ registration_code: code, label, location }, opts);
  } catch (e) {
    throw new InvoiceError(`Gerät nicht registriert: ${(e as Error).message}`);
  }
  const [row] = await db().insert(terminalReaders).values({ hotelId: hotel.id, stripeReaderId: reader.id, stripeLocationId: location, label }).returning();
  await audit(db(), { hotelId: hotel.id, actor, action: "terminal.reader_register", entity: "terminal_reader", entityId: row.id, details: { label } });
  return row;
}

/** Zahlung am Terminal starten. Ein PaymentIntent je Zahlung; bei Fehler vor dem Gerät wird er storniert. */
export async function startTerminalPayment(hotel: Hotel, bookingId: string, readerId: string, amountRappen: number, actor: string): Promise<TerminalPayment> {
  const opts = needAccount(hotel);
  if (!Number.isInteger(amountRappen) || amountRappen <= 0 || amountRappen > TERMINAL_MAX_RAPPEN) throw new InvoiceError("Bitte einen Betrag zwischen 0.01 und 10 000 CHF angeben.");
  const [reader] = await db().select().from(terminalReaders).where(and(eq(terminalReaders.id, readerId), eq(terminalReaders.hotelId, hotel.id)));
  if (!reader) throw new InvoiceError("Kartenleser nicht gefunden.");
  const [b] = await db().select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotel.id)));
  if (!b) throw new InvoiceError("Buchung nicht gefunden.");
  const open = (await bookingBalance(db(), hotel.id, bookingId)).openRappen;
  if (amountRappen > open) throw new InvoiceError("Der Betrag ist höher als der offene Betrag.");
  const busy = await db().select().from(terminalPayments).where(and(eq(terminalPayments.readerId, reader.id), eq(terminalPayments.status, "pending")));
  if (busy.length) throw new InvoiceError("Auf diesem Leser läuft noch eine Zahlung. Bitte abschliessen, prüfen oder abbrechen.");
  const [tp] = await db().insert(terminalPayments).values({ hotelId: hotel.id, bookingId, readerId: reader.id, amountRappen, actor }).returning();
  try {
    const pi = await stripe().paymentIntents.create(
      {
        amount: amountRappen,
        currency: "chf",
        allowed_payment_method_types: ["card_present"],
        capture_method: "automatic",
        // ASSUMPTION: application_fee_amount wie bei Online-Zahlungen (Direct Charge); auf den Terminal-Seiten nicht ausdrücklich gezeigt.
        application_fee_amount: platformFee(amountRappen, hotel.platformFeeBps) || undefined,
        metadata: { booking_id: bookingId, hotel_id: hotel.id, terminal_payment_id: tp.id },
      },
      { ...opts, idempotencyKey: `terminal-pi-${tp.id}` },
    );
    await db().update(terminalPayments).set({ paymentIntentId: pi.id, updatedAt: new Date() }).where(eq(terminalPayments.id, tp.id));
    try {
      await stripe().terminal.readers.processPaymentIntent(reader.stripeReaderId, { payment_intent: pi.id, process_config: { enable_customer_cancellation: true } }, opts);
    } catch (e) {
      await stripe().paymentIntents.cancel(pi.id, {}, opts).catch(() => undefined);
      throw e;
    }
  } catch (e) {
    const code = (e as { code?: string }).code ?? "error";
    await db().update(terminalPayments).set({ status: "failed", failureCode: String(code).slice(0, 80), updatedAt: new Date() }).where(eq(terminalPayments.id, tp.id));
    const msg = code === "terminal_reader_offline" ? "Der Kartenleser ist offline." : code === "terminal_reader_busy" ? "Der Kartenleser ist beschäftigt." : "Zahlung konnte nicht gestartet werden.";
    throw new InvoiceError(msg);
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "terminal.start", entity: "booking", entityId: bookingId, details: { amount: amountRappen, tp: tp.id } });
  return (await db().select().from(terminalPayments).where(eq(terminalPayments.id, tp.id)))[0];
}

/**
 * Ergebnis einer Terminal-Zahlung übernehmen (Webhook oder «Status prüfen»). Idempotent.
 * Erfolg wird immer am PaymentIntent bei Stripe geprüft (status succeeded, Betrag), nie nur am Ereignis.
 */
export async function settleTerminalPayment(paymentIntentId: string, account: string | undefined, hint?: { failed?: string }): Promise<"succeeded" | "failed" | "pending" | "ignored"> {
  const [tp] = await db().select().from(terminalPayments).where(eq(terminalPayments.paymentIntentId, paymentIntentId));
  if (!tp) return "ignored";
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, tp.hotelId));
  if (!hotel || !hotel.stripeAccountId || (account && account !== hotel.stripeAccountId)) throw new Error(`Terminal-Ereignis von Konto ${account} passt nicht zum Hotel der Zahlung ${tp.id}`);
  if (tp.status !== "pending") return tp.status === "succeeded" ? "succeeded" : "failed";
  const pi = await stripe().paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: hotel.stripeAccountId });
  if (pi.status === "succeeded") {
    if ((pi.amount_received ?? pi.amount) !== tp.amountRappen) throw new Error(`Terminal-Betrag weicht ab (${pi.amount_received} statt ${tp.amountRappen})`);
    const claimed = await db().update(terminalPayments).set({ status: "succeeded", updatedAt: new Date() }).where(and(eq(terminalPayments.id, tp.id), eq(terminalPayments.status, "pending"))).returning();
    if (!claimed.length) return "succeeded";
    try {
      const pay = await recordOnsitePayment(hotel, tp.bookingId, { amountRappen: tp.amountRappen, method: "card", note: "Kartenterminal" }, tp.actor);
      await db().update(terminalPayments).set({ onsitePaymentId: pay.id }).where(eq(terminalPayments.id, tp.id));
    } catch (e) {
      await db().update(terminalPayments).set({ status: "pending" }).where(eq(terminalPayments.id, tp.id)); // Webhook/Prüfen wiederholt
      throw e;
    }
    return "succeeded";
  }
  if (pi.status === "canceled" || hint?.failed) {
    await db().update(terminalPayments).set({ status: pi.status === "canceled" ? "canceled" : "failed", failureCode: (hint?.failed ?? "canceled").slice(0, 80), updatedAt: new Date() }).where(and(eq(terminalPayments.id, tp.id), eq(terminalPayments.status, "pending")));
    return "failed";
  }
  return "pending";
}

/** «Status prüfen»: Leser und PaymentIntent bei Stripe abfragen */
export async function checkTerminalPayment(hotel: Hotel, id: string): Promise<string> {
  const opts = needAccount(hotel);
  const [tp] = await db().select().from(terminalPayments).where(and(eq(terminalPayments.id, id), eq(terminalPayments.hotelId, hotel.id)));
  if (!tp?.paymentIntentId) throw new InvoiceError("Zahlung nicht gefunden.");
  const [reader] = await db().select().from(terminalReaders).where(eq(terminalReaders.id, tp.readerId));
  let failed: string | undefined;
  if (reader) {
    const r = await stripe().terminal.readers.retrieve(reader.stripeReaderId, {}, opts);
    const a = (r as { action?: { status?: string; failure_code?: string | null; process_payment_intent?: { payment_intent?: string } } }).action;
    if (a?.status === "failed" && a.process_payment_intent?.payment_intent === tp.paymentIntentId) failed = a.failure_code ?? "failed";
  }
  const res = await settleTerminalPayment(tp.paymentIntentId, hotel.stripeAccountId!, { failed });
  return res === "succeeded" ? "Zahlung erhalten und verbucht." : res === "failed" ? "Zahlung nicht erfolgt." : "Noch in Bearbeitung am Gerät.";
}

/** Laufende Zahlung abbrechen (nur solange der Leser nicht autorisiert) */
export async function cancelTerminalPayment(hotel: Hotel, id: string, actor: string): Promise<void> {
  const opts = needAccount(hotel);
  const [tp] = await db().select().from(terminalPayments).where(and(eq(terminalPayments.id, id), eq(terminalPayments.hotelId, hotel.id), eq(terminalPayments.status, "pending")));
  if (!tp?.paymentIntentId) throw new InvoiceError("Keine laufende Zahlung.");
  const [reader] = await db().select().from(terminalReaders).where(eq(terminalReaders.id, tp.readerId));
  try {
    if (reader) await stripe().terminal.readers.cancelAction(reader.stripeReaderId, {}, opts);
    await stripe().paymentIntents.cancel(tp.paymentIntentId, {}, opts);
  } catch (e) {
    throw new InvoiceError(`Abbruch nicht möglich (Zahlung läuft evtl. gerade): ${(e as Error).message}`);
  }
  await db().update(terminalPayments).set({ status: "canceled", failureCode: "canceled", updatedAt: new Date() }).where(eq(terminalPayments.id, tp.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "terminal.cancel", entity: "booking", entityId: tp.bookingId, details: { tp: tp.id } });
}
