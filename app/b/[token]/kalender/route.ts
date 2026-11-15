import { getBookingByToken } from "@/src/services/bookings";
import { bookingIcs } from "@/src/domain/portal";

export const dynamic = "force-dynamic";

/** Kalendereintrag (.ics) zur Buchung, nur mit gültigem Buchungslink und bestätigter Buchung (SPEC 19.13) */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const f = await getBookingByToken(token);
  if (!f || f.booking.status !== "confirmed") return new Response("Not found", { status: 404 });
  const { booking, hotel } = f;
  const address = [hotel.addressLine, [hotel.postalCode, hotel.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const body = bookingIcs({ reference: booking.reference, hotelName: hotel.name, address, checkin: booking.checkin, checkout: booking.checkout, checkinTime: hotel.checkinTime.slice(0, 5), description: `${booking.reference} · Check-in ${hotel.checkinTime.slice(0, 5)}, Check-out ${hotel.checkoutTime.slice(0, 5)}` });
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${booking.reference}.ics"`, "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
}
