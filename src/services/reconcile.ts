import { eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { hotels, type Hotel } from "../db/schema";
import { env } from "../env";
import { stripe } from "../integrations/stripe/client";
import { raiseAlert } from "./monitor";

/**
 * Nächtlicher Zahlungsabgleich: findet Fälle, in denen Zahlung und Buchung nicht zusammenpassen
 * (z. B. ein Webhook ist ausgefallen) und meldet sie per Alarm-Mail. Ändert selbst nichts.
 *  A) Zahlung bei Stripe «paid», aber Buchung nie bestätigt (Hold abgelaufen/storniert)
 *  B) Bestätigte Direktbuchung ohne erfolgreiche Zahlung (Restbetrag > 0 nach Gutschein)
 *  C) Zahlung erfolgreich, aber Buchung abgelaufen und nichts rückerstattet
 */

export type SessionPaid = (hotel: Hotel, sessionId: string) => Promise<boolean>;

/** Fragt Stripe (Checkout Session auf dem Konto des Hotels): bezahlt? */
export const stripeSessionPaid: SessionPaid = async (hotel, sessionId) => {
  if (!hotel.stripeAccountId) return false;
  const s = await stripe().checkout.sessions.retrieve(sessionId, undefined, { stripeAccount: hotel.stripeAccountId });
  return s.payment_status === "paid";
};

const DAY = 864e5;

export async function reconcilePayments(now = new Date(), opts: { sessionPaid?: SessionPaid } = {}): Promise<{ issues: number; alerts: number }> {
  const iso = (ms: number) => new Date(now.getTime() - ms).toISOString();
  let issues = 0;
  let alerts = 0;
  const flag = async (kind: string, bookingId: string, subject: string, details: string) => {
    issues++;
    if (await raiseAlert(`reconcile:${kind}:${bookingId}`, subject, details, now, DAY)) alerts++;
  };

  // A) Stripe-seitig bezahlt, Buchung nicht bestätigt
  const sessionPaid = opts.sessionPaid ?? (env().PAYMENT_PROVIDER === "stripe" ? stripeSessionPaid : null);
  if (sessionPaid) {
    const open = rows<{ booking_id: string; hotel_id: string; session: string; reference: string; status: string }>(await db().execute(sql`
      SELECT p.booking_id, p.hotel_id, p.stripe_checkout_session_id AS session, b.reference, b.status
        FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE p.status = 'pending' AND b.status IN ('hold','expired','cancelled')
         AND p.created_at < ${iso(30 * 60_000)}::timestamptz AND p.created_at > ${iso(5 * DAY)}::timestamptz
         AND p.stripe_checkout_session_id IS NOT NULL
       ORDER BY p.created_at DESC LIMIT 200`));
    for (const o of open) {
      const [h] = await db().select().from(hotels).where(eq(hotels.id, o.hotel_id));
      if (!h) continue;
      let paid = false;
      try {
        paid = await sessionPaid(h, o.session);
      } catch (e) {
        console.error("[reconcile] Stripe-Abfrage fehlgeschlagen:", (e as Error).message);
      }
      if (paid) await flag("A", o.booking_id, "Zahlung ohne bestätigte Buchung", `${h.name}: Buchung ${o.reference} (${o.status}) wurde bei Stripe bezahlt, ist aber nicht bestätigt. Bitte im Stripe-Dashboard prüfen und ggf. rückerstatten oder die Buchung nachführen.`);
    }
  }

  // B) bestätigte Direktbuchung ohne erfolgreiche Zahlung
  const noPay = rows<{ id: string; reference: string; hotel: string }>(await db().execute(sql`
    SELECT b.id, b.reference, h.name AS hotel FROM bookings b JOIN hotels h ON h.id = b.hotel_id
     WHERE b.source = 'direct' AND b.status = 'confirmed' AND b.confirmed_at > ${iso(30 * DAY)}::timestamptz
       AND b.total_rappen - b.voucher_rappen > 0
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status IN ('succeeded','refunded','partially_refunded'))
     LIMIT 200`));
  for (const b of noPay) await flag("B", b.id, "Buchung ohne Zahlung", `${b.hotel}: Buchung ${b.reference} ist bestätigt, aber es gibt keine erfolgreiche Zahlung.`);

  // C) bezahlt, aber Buchung abgelaufen und nichts rückerstattet
  const late = rows<{ id: string; reference: string; hotel: string }>(await db().execute(sql`
    SELECT b.id, b.reference, h.name AS hotel FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN hotels h ON h.id = b.hotel_id
     WHERE p.status = 'succeeded' AND b.status = 'expired' AND p.refunded_rappen = 0 AND p.updated_at > ${iso(30 * DAY)}::timestamptz
     LIMIT 200`));
  for (const b of late) await flag("C", b.id, "Bezahlt, aber Buchung abgelaufen", `${b.hotel}: Buchung ${b.reference} ist abgelaufen, die Zahlung ging ein und wurde nicht rückerstattet.`);

  return { issues, alerts };
}
