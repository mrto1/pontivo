import { notFound } from "next/navigation";
import { getBookingByToken, cancellationPreview } from "@/src/services/bookings";
import { cancellationPolicyText } from "@/src/domain/cancellation";
import { diffDays } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { formatDay, isLocale, t, type Locale } from "@/src/i18n/dict";
import { Shell } from "@/components/public/Shell";
import { arrivalAllowed, arrivalText } from "@/src/services/arrival";
import { CHAT_TEXT } from "@/src/i18n/chat";
import { planName, roomName } from "@/src/domain/i18n-names";
import { CancelBox } from "@/components/public/CancelBox";
import { AutoRefresh } from "@/components/public/AutoRefresh";
import { checkinContext } from "@/src/services/guests";
import { CI } from "@/src/i18n/checkin";
import { bookingExtrasOf } from "@/src/services/extras";
import { tr } from "@/src/domain/blocks";
import { balanceOpen } from "@/src/services/balance";
import { fill } from "@/src/i18n/dict";

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
  const ci = await checkinContext(token);
  const extras = await bookingExtrasOf(booking.id);
  // Ankunftsinfos (Code, WLAN …) nur während des Aufenthalts einer bestätigten Buchung
  const arrival = arrivalAllowed({ booking, hotel }) ? arrivalText({ hotel, roomType }, locale) : "";

  return (
    <Shell hotel={hotel} locale={locale} base={base} chatToken={token}>
      <section style={{ padding: "32px 0" }}>
        <h1>{d.booking}</h1>
        {sp.paid && booking.status === "confirmed" ? <p className="notice">{d.paidThanks}</p> : null}
        {sp.paid && booking.status === "hold" ? (<><p className="notice">{d.paymentPending}</p><AutoRefresh seconds={3} /></>) : null}
        {sp.balance_paid ? <p className="notice">{d.balancePaidThanks}</p> : null}
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
              {extras.map((x) => <tr key={x.id}><td>{tr(x.name, locale)}{x.quantity > 1 ? ` × ${x.quantity}` : ""}</td><td>{formatChf(x.amountRappen)}</td></tr>)}
              <tr><td>{d.touristTax}</td><td>{hotel.touristTaxIncludedInPrice ? d.included : formatChf(booking.touristTaxRappen)}</td></tr>
              <tr><td><strong>{d.total}</strong></td><td><strong>{formatChf(booking.totalRappen)}</strong></td></tr>
              {booking.voucherRappen > 0 ? (<>
                <tr><td>{d.voucherPaid}</td><td>− {formatChf(booking.voucherRappen)}</td></tr>
                <tr><td>{d.cardPaid}</td><td>{formatChf(booking.totalRappen - booking.voucherRappen)}</td></tr>
              </>) : null}
              {booking.balanceRappen > 0 ? (
                <tr><td>{d.balanceTitle}</td><td>{booking.balancePaidAt || booking.balanceOnsiteAt ? `${formatChf(booking.balanceRappen)} ✓ ${d.balancePaid}` : fill(d.balanceOpen, { a: formatChf(booking.balanceRappen), date: booking.balanceDueOn ? formatDay(booking.balanceDueOn, locale) : "" })}</td></tr>
              ) : null}
            </tbody>
          </table>
          {balanceOpen(booking) ? (
            <form method="post" action={`/b/${token}/balance`} style={{ marginTop: 16 }}>
              <button className="btn">{d.payBalance} ({formatChf(booking.balanceRappen)})</button>
            </form>
          ) : null}
          {plan ? (<><h3 style={{ marginTop: 20 }}>{d.cancellation}</h3><p className="small muted">{cancellationPolicyText(plan, locale)}</p></>) : null}
          {preview?.cancellable ? <CancelBox token={token} locale={locale} /> : null}
        </div>
        {arrival ? (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>{CHAT_TEXT[locale].arrivalTitle}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{arrival}</p>
          </div>
        ) : null}
        {ci?.open ? (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>{CI[locale].linkTitle}</h3>
            {ci.submitted ? <p>✓ {CI[locale].linkDone}</p> : <p>{CI[locale].linkText}</p>}
            {ci.verified ? null : <a className={`btn${ci.submitted ? " secondary small" : ""}`} href={`/b/${token}/checkin?lang=${locale}`}>{ci.submitted ? CI[locale].correct : CI[locale].linkButton}</a>}
          </div>
        ) : null}
      </section>
    </Shell>
  );
}
