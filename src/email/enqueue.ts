import type { Executor } from "../db/client";
import { emailOutbox } from "../db/schema";

export type TemplateName =
  | "voucher_purchased"
  | "hotel_voucher_sold"
  | "inquiry_received"
  | "inquiry_confirmation"
  | "booking_confirmed"
  | "hotel_new_booking"
  | "booking_cancelled"
  | "pre_arrival"
  | "post_stay"
  | "overbooking_alert"
  | "checkin_link"
  | "late_payment_refunded"
  | "dispute_alert"
  | "login_link"
  | "channex_alert";

/** SPEC 10: E-Mails nur über die Outbox. Gleiche Kombination booking/template/to wird nur einmal eingereiht. */
export async function enqueueEmail(
  ex: Executor,
  e: {
    hotelId: string | null;
    bookingId?: string | null;
    template: TemplateName;
    to: string;
    language?: string;
    data?: Record<string, unknown>;
    sendAfter?: Date;
  },
) {
  await ex
    .insert(emailOutbox)
    .values({
      hotelId: e.hotelId,
      bookingId: e.bookingId ?? null,
      template: e.template,
      toEmail: e.to,
      language: e.language ?? "de",
      data: e.data ?? {},
      sendAfter: e.sendAfter ?? new Date(),
    })
    .onConflictDoNothing();
}
