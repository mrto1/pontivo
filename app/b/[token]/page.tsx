import { notFound } from "next/navigation";
import { getBookingByToken, cancellationPreview } from "@/src/services/bookings";
import { cancellationPolicyText } from "@/src/domain/cancellation";
import { diffDays } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { formatDay, isLocale, t, type Locale } from "@/src/i18n/dict";
import { Shell } from "@/components/public/Shell";
import { planName, roomName } from "@/src/domain/i18n-names";
import { CancelBox } from "@/components/public/CancelBox";
import { AutoRefresh } from "@/components/public/AutoRefresh";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function BookingView({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const found = await getBookingByToken(token);
  if (!found) notFound();
  const { booking, hotel, roomType, plan, guest } = found;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : isLocale(booking.language) ? booking.language : "de";
  const d = t(locale);
  const n = diffDays(booking.checkin, booking.checkout);
  const preview = booking.status === "confirmed" ? await cancellationPreview(booking.id, { by: "guest" }) : null;
  const base = hotel.primaryDomain ? "" : `/h/${hotel.slug}`;

  return (
    <Shell hotel={hotel} locale={locale} base={base}>
      <section style={{ padding: "32px 0" }}>
        <h1>{d.booking}</h1>
        {sp.paid && booking.status === "confirmed" ? <p className="notice">{d.paidThanks}</p> : null}
        {sp.paid && booking.status === "hold" ? (<><p className="notice">{d.paymentPending}</p><AutoRefresh seconds={3} /></>) : null}
        {sp.cancelled_payment && booking.status === "hold" ? <p className="notice warn">{d.paymentAborted}</p> : null}
        <div className="card">
          <table className="rows">
            <tbody>
              <tr><td>{d.reference}</td><td><strong>{booking.reference}</strong></td></tr>
              <tr><td>{d.status}</td><td><span className={`badge ${booking.status === "confirmed" ? "" : "warn"}`}>{d[`st_${booking.status}` as keyof typeof d]}</span></td></tr>
              {guest ? <tr><td>{d.guest}</td><td>{guest.firstName} {guest.lastName}</td></tr> : null}
              <tr><td>{d.checkin}</td><td>{formatDay(booking.checkin, locale)} ({hotel.checkinTime.slice(0, 5)})</td></tr>
              <tr><td>{d.checkout}</td><td>{formatDay(booking.checkout, locale)} ({hotel.checkoutTime.slice(0, 5)})</td></tr>
              <tr><td>{roomType ? roomName(roomType, locale) : ""}{plan ? ` · ${planName(plan, locale)}` : ""}</td><td>{n} {n === 1 ? d.night : d.nights} · {booking.adults} {d.adults}{booking.children ? `, ${booking.children} ${d.children}` : ""}</td></tr>
              <tr><td>{d.roomPrice}</td><td>{formatChf(booking.roomsTotalRappen)}</td></tr>
              <tr><td>{d.touristTax}</td><td>{hotel.touristTaxIncludedInPrice ? d.included : formatChf(booking.touristTaxRappen)}</td></tr>
              <tr><td><strong>{d.total}</strong></td><td><strong>{formatChf(booking.totalRappen)}</strong></td></tr>
              {booking.voucherRappen > 0 ? (<>
                <tr><td>{d.voucherPaid}</td><td>− {formatChf(booking.voucherRappen)}</td></tr>
                <tr><td>{d.cardPaid}</td><td>{formatChf(booking.totalRappen - booking.voucherRappen)}</td></tr>
              </>) : null}
            </tbody>
          </table>
          {plan ? (<><h3 style={{ marginTop: 20 }}>{d.cancellation}</h3><p className="small muted">{cancellationPolicyText(plan, locale)}</p></>) : null}
          {preview?.cancellable ? <CancelBox token={token} locale={locale} /> : null}
        </div>
      </section>
    </Shell>
  );
}
