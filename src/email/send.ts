import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookingRooms, bookings, emailOutbox, guests, hotels, ratePlans, roomTypes, type Hotel, bookingExtras } from "../db/schema";
import { env } from "../env";
import { render, type Rendered } from "./templates";

export type Mailer = (msg: { from: string; to: string; subject: string; html: string; text: string }) => Promise<void>;

let override: Mailer | null = null;
export function setMailer(m: Mailer | null) {
  override = m;
}

/** Postmark, wenn POSTMARK_SERVER_TOKEN gesetzt ist; sonst Ausgabe in der Konsole (Entwicklung). */
async function defaultMailer(msg: Parameters<Mailer>[0]) {
  const token = env().POSTMARK_SERVER_TOKEN;
  if (!token) {
    console.log(`[mail] an ${msg.to}: ${msg.subject}\n${msg.text}\n`);
    return;
  }
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "X-Postmark-Server-Token": token },
    body: JSON.stringify({ From: msg.from, To: msg.to, Subject: msg.subject, HtmlBody: msg.html, TextBody: msg.text, MessageStream: "outbound" }),
  });
  if (!res.ok) throw new Error(`Postmark ${res.status}: ${await res.text()}`);
}

const PLATFORM_DEFAULT_HOTEL = { name: process.env.PLATFORM_NAME || "Pontivo", contactEmail: "", contactPhone: null, checkinTime: "15:00", checkoutTime: "11:00" } as unknown as Hotel;

async function renderRow(row: typeof emailOutbox.$inferSelect): Promise<Rendered> {
  const [hotel] = row.hotelId ? await db().select().from(hotels).where(eq(hotels.id, row.hotelId)) : [];
  const [booking] = row.bookingId ? await db().select().from(bookings).where(eq(bookings.id, row.bookingId)) : [];
  const [room] = booking ? await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id)) : [];
  const [roomType] = room ? await db().select().from(roomTypes).where(eq(roomTypes.id, room.roomTypeId)) : [];
  const [plan] = room?.ratePlanId ? await db().select().from(ratePlans).where(eq(ratePlans.id, room.ratePlanId)) : [];
  const [guest] = booking?.guestId ? await db().select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const extras = booking ? await db().select().from(bookingExtras).where(eq(bookingExtras.bookingId, booking.id)).orderBy(bookingExtras.position) : [];
  return render(row.template, row.language, {
    extras,
    hotel: hotel ?? PLATFORM_DEFAULT_HOTEL,
    booking,
    roomType,
    plan,
    guestName: guest ? `${guest.firstName} ${guest.lastName}` : null,
    data: row.data,
    baseUrl: hotel?.primaryDomain && env().NODE_ENV === "production" ? `https://${hotel.primaryDomain}` : env().APP_BASE_URL,
  });
}

/** Job "emails": fällige E-Mails senden, 3 Versuche (SPEC 10) */
export async function sendDueEmails(now: Date = new Date(), limit = 50): Promise<{ sent: number; failed: number }> {
  const due = await db()
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.sendAfter, now)))
    .orderBy(emailOutbox.id)
    .limit(limit);
  const mailer = override ?? defaultMailer;
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    // Zeile beanspruchen (parallel laufende Worker)
    const claimed = await db()
      .update(emailOutbox)
      .set({ attempts: sql`${emailOutbox.attempts} + 1` })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "pending"), eq(emailOutbox.attempts, row.attempts)))
      .returning();
    if (!claimed.length) continue;
    try {
      const r = await renderRow(row);
      await mailer({ from: env().EMAIL_FROM, to: row.toEmail, ...r });
      await db().update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (e) {
      const attempts = claimed[0].attempts;
      await db()
        .update(emailOutbox)
        .set(attempts >= 3 ? { status: "failed" } : { sendAfter: new Date(Date.now() + attempts * 5 * 60_000) })
        .where(eq(emailOutbox.id, row.id));
      console.error("[mail] Fehler", row.id, (e as Error).message);
      failed++;
    }
  }
  return { sent, failed };
}
