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
import { ResumePayment } from "@/components/public/ResumePayment";
import { PAY } from "@/src/i18n/pay";
import { hasElementPayment } from "@/src/services/element-payments";
import { checkinContext } from "@/src/services/guests";
import { CI } from "@/src/i18n/checkin";
import { bookingExtrasOf } from "@/src/services/extras";
import { tr } from "@/src/domain/blocks";
import { balanceOpen } from "@/src/services/balance";
import { fill } from "@/src/i18n/dict";
import { PORTAL } from "@/src/i18n/portal";
import { offerForBooking } from "@/src/services/upsell";
import { redirect } from "next/navigation";
import { todayIn } from "@/src/domain/dates";
import { requestsEnabled, selfCheckoutEnabled, selfCheckoutOpen, wishLabel, wishOptions } from "@/src/domain/portal";
import { MAX_MESSAGE, RequestError, createGuestRequest, requestsOfBooking, requestsOpen, selfCheckout } from "@/src/services/guest-requests";
import { portalDoorCodes, portalFolio } from "@/src/services/guest-portal";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Wunsch senden (Link ist der Zugang; Grenzen pro Buchung in src/services/guest-requests.ts) */
async function sendWish(f: FormData) {
  "use server";
  const token = String(f.get("token") ?? "");
  const lang = String(f.get("lang") ?? "de");
  const found = await getBookingByToken(token);
  if (!found) notFound();
  let q = "wish=1";
  try {
    await createGuestRequest(found.hotel, found.booking.id, { itemId: String(f.get("item") ?? ""), message: String(f.get("message") ?? "") }, todayIn(found.hotel.timezone), lang);
  } catch (e) {
    if (!(e instanceof RequestError)) throw e;
    q = `wisherr=${e.code === "empty" ? "empty" : e.code === "closed" ? "closed" : "many"}`;
  }
  redirect(`/b/${token}?lang=${lang}&${q}#wuensche`);
}

async function doCheckout(f: FormData) {
  "use server";
  const token = String(f.get("token") ?? "");
  const lang = String(f.get("lang") ?? "de");
  const found = await getBookingByToken(token);
  if (!found) notFound();
  try {
    await selfCheckout(found.hotel, found.booking.id, todayIn(found.hotel.timezone));
  } catch (e) {
    if (!(e instanceof RequestError)) throw e;
  }
  redirect(`/b/${token}?lang=${lang}&out=1`);
}

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

  // Payment Element (SPEC 19.52): offene Zahlung einer noch reservierten Buchung kann fortgesetzt werden
  const resumable = booking.status === "hold" && (await hasElementPayment(booking.id));
  const pt = PORTAL[locale];
  const guestInfo = booking.status === "confirmed" ? tr(hotel.content.guestInfo, locale).trim() : "";
  const extrasOffer = await offerForBooking(token);
  const portal = hotel.content.portal;
  const today = todayIn(hotel.timezone);
  const tips = booking.status === "confirmed" ? (portal?.tips ?? []).map((x) => ({ id: x.id, title: tr(x.title, locale).trim(), text: tr(x.text, locale).trim() })).filter((x) => x.title) : [];
  const door = await portalDoorCodes(token, hotel, booking);
  const folio = await portalFolio(hotel, booking);
  const myRequests = booking.status === "confirmed" ? await requestsOfBooking(hotel.id, booking.id) : [];
  const canWish = requestsEnabled(portal) && requestsOpen(booking, today);
  const wishes = wishOptions(portal);
  const canOut = selfCheckoutOpen(booking, today, selfCheckoutEnabled(portal));
  return (
    <Shell hotel={hotel} locale={locale} base={base} chatToken={token}>
      <section className="pad32">
        <h1>{d.booking}</h1>
        {sp.paid && booking.status === "confirmed" ? <p className="notice">{d.paidThanks}</p> : null}
        {sp.redirect_status === "failed" && booking.status === "hold" ? <p className="notice warn">{PAY[locale].failedReturn}</p> : null}
        {sp.paid && booking.status === "hold" && sp.redirect_status !== "failed" ? (<><p className="notice">{d.paymentPending}</p><AutoRefresh seconds={3} /></>) : null}
        {sp.balance_paid ? <p className="notice">{d.balancePaidThanks}</p> : null}
        {sp.cancelled_payment && booking.status === "hold" ? <p className="notice warn">{d.paymentAborted}</p> : null}
        {booking.status === "hold" && resumable ? <ResumePayment locale={locale} token={token} returnUrl={`${base}/b/${token}?paid=1`} rebookHref={`${base}/`} /> : null}
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
            <form method="post" action={`/b/${token}/balance`} className="mt16">
              <button className="btn">{d.payBalance} ({formatChf(booking.balanceRappen)})</button>
            </form>
          ) : null}
          {plan ? (<><h3 className="u-mt-20px">{d.cancellation}</h3><p className="small muted">{cancellationPolicyText(plan, locale)}</p></>) : null}
          {preview?.cancellable ? <CancelBox token={token} locale={locale} /> : null}
          {booking.status === "confirmed" ? <p className="mt16"><a className="btn secondary small" href={`/b/${token}/kalender`}>{pt.calendar}</a></p> : null}
        </div>
        {guestInfo ? (
          <div className="card mt16">
            <h3>{pt.infoTitle}</h3>
            <p className="pre-wrap">{guestInfo}</p>
          </div>
        ) : null}
        {extrasOffer ? (
          <div className="card mt16">
            <h3>{pt.extrasTitle}</h3>
            <p>{pt.extrasText}</p>
            <a className="btn" href={`/b/${token}/upsell?lang=${locale}`}>{pt.extrasButton}</a>
          </div>
        ) : null}
        {arrival ? (
          <div className="card mt16">
            <h3>{CHAT_TEXT[locale].arrivalTitle}</h3>
            <p className="pre-wrap">{arrival}</p>
          </div>
        ) : null}
        {door.codes.length ? (
          <div className="card mt16">
            <h3>{pt.keyTitle}</h3>
            <p>{pt.keyText}</p>
            {door.codes.map((c) => (
              <p className="u-m-8px-0" key={c.lock}>
                <span className="muted small">{c.lock}</span><br />
                <strong className="u-fs-1-8rem u-lsp-0-2em u-fvn-tabular-nums">{c.code}</strong>
                <span className="muted small"> · {pt.keyUntil} {c.validUntil.toLocaleString(locale === "de" ? "de-CH" : locale, { timeZone: hotel.timezone, dateStyle: "short", timeStyle: "short" })}</span>
              </p>
            ))}
          </div>
        ) : door.waitingForCheckin ? (
          <div className="card mt16">
            <h3>{pt.keyTitle}</h3>
            <p>{pt.keyNeedCheckin}</p>
          </div>
        ) : null}
        {tips.length ? (
          <div className="card mt16">
            <h3>{pt.tipsTitle}</h3>
            <ul className="list">
              {tips.map((x) => <li key={x.id}><strong>{x.title}</strong>{x.text ? <div className="small pre-wrap">{x.text}</div> : null}</li>)}
            </ul>
          </div>
        ) : null}
        {folio && (folio.items.length || folio.openRappen > 0) ? (
          <div className="card mt16">
            <h3>{pt.folioTitle}</h3>
            <table className="rows">
              <tbody>
                {folio.items.map((x) => <tr key={x.id}><td>{x.description}{x.quantity > 1 ? ` × ${x.quantity}` : ""}</td><td>{formatChf(x.quantity * x.unitPriceRappen)}</td></tr>)}
                <tr><td><strong>{pt.folioOpen}</strong></td><td><strong>{formatChf(Math.max(0, folio.openRappen))}</strong></td></tr>
              </tbody>
            </table>
            <p className="small muted">{pt.folioNote}</p>
          </div>
        ) : null}
        {canWish || myRequests.length ? (
          <div className="card mt16" id="wuensche" >
            <h3>{pt.wishTitle}</h3>
            {sp.wish ? <p className="notice">{pt.wishSent}</p> : null}
            {sp.wisherr ? <p className="notice warn">{pt.wishErr[sp.wisherr as "empty" | "many" | "closed"] ?? pt.wishErr.many}</p> : null}
            {canWish ? (
              <form action={sendWish} className="stack">
                <p>{pt.wishText}</p>
                <input type="hidden" name="token" value={token} /><input type="hidden" name="lang" value={locale} />
                {wishes.length ? (
                  <select name="item" aria-label={pt.wishPick} defaultValue="">
                    <option value="">{pt.wishPick}</option>
                    {wishes.map((w) => <option key={w.id} value={w.id}>{wishLabel(w, locale)}</option>)}
                  </select>
                ) : null}
                <textarea name="message" rows={2} maxLength={MAX_MESSAGE} placeholder={pt.wishFree} aria-label={pt.wishFree} />
                <div><button className="btn">{pt.wishSend}</button></div>
              </form>
            ) : null}
            {myRequests.length ? (
              <>
                <h4 className="mt16">{pt.wishListTitle}</h4>
                <ul className="list">
                  {myRequests.filter((r) => r.itemId !== "checkout").map((r) => {
                    const opt = wishes.find((w) => w.id === r.itemId);
                    return (
                      <li key={r.id}>
                        <span className={`badge ${r.status === "done" ? "" : "warn"}`}>{r.status === "done" ? pt.wishDone : pt.wishOpen}</span>{" "}
                        <strong>{opt ? wishLabel(opt, locale) : r.itemId ? r.label : ""}</strong>{r.message ? <span className="small"> {r.itemId ? "· " : ""}{r.message}</span> : null}
                        {r.status === "done" && r.note ? <div className="small muted">{r.note}</div> : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        {booking.guestCheckoutAt || sp.out ? (
          <div className="card mt16"><p className="m0">✓ {pt.outDone}</p></div>
        ) : canOut ? (
          <div className="card mt16">
            <h3>{pt.outTitle}</h3>
            <p>{pt.outText}</p>
            <form action={doCheckout}>
              <input type="hidden" name="token" value={token} /><input type="hidden" name="lang" value={locale} />
              <button className="btn">{pt.outButton}</button>
            </form>
          </div>
        ) : null}
        {ci?.open ? (
          <div className="card mt16">
            <h3>{CI[locale].linkTitle}</h3>
            {ci.submitted ? <p>✓ {CI[locale].linkDone}</p> : <p>{CI[locale].linkText}</p>}
            {ci.verified ? null : <a className={`btn${ci.submitted ? " secondary small" : ""}`} href={`/b/${token}/checkin?lang=${locale}`}>{ci.submitted ? CI[locale].correct : CI[locale].linkButton}</a>}
          </div>
        ) : null}
      </section>
    </Shell>
  );
}
