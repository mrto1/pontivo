import { notFound, redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { bookingDetail } from "@/src/services/admin-bookings";
import { BookingError, cancelBooking, cancellationPreview, markNoShow } from "@/src/services/bookings";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";

export const dynamic = "force-dynamic";

async function cancelAction(formData: FormData) {
  "use server";
  const hotelId = String(formData.get("hotelId"));
  const bookingId = String(formData.get("bookingId"));
  const { actor } = await requireHotel(hotelId, "manager");
  let msg = "Buchung storniert";
  try {
    const r = await cancelBooking(bookingId, { by: "hotel", actor, hotelId, reason: String(formData.get("reason") || "by_hotel") });
    msg = `Storniert, Rückerstattung ${formatChf(r.refundRappen)}`;
  } catch (e) {
    msg = e instanceof BookingError ? `Nicht möglich: ${e.code}` : `Fehler: ${(e as Error).message}`;
  }
  redirect(`/admin/${hotelId}/bookings/${bookingId}?msg=${encodeURIComponent(msg)}`);
}

async function noShowAction(formData: FormData) {
  "use server";
  const hotelId = String(formData.get("hotelId"));
  const bookingId = String(formData.get("bookingId"));
  const { actor } = await requireHotel(hotelId, "staff");
  let msg = "Als No-Show markiert";
  try {
    await markNoShow(hotelId, bookingId, actor);
  } catch (e) {
    msg = e instanceof BookingError ? `Nicht möglich: ${e.message}` : String(e);
  }
  redirect(`/admin/${hotelId}/bookings/${bookingId}?msg=${encodeURIComponent(msg)}`);
}

export default async function BookingDetail({ params, searchParams }: { params: Promise<{ hotelId: string; bookingId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId, bookingId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const d = await bookingDetail(hotel.id, bookingId);
  if (!d) notFound();
  const { booking: b, guest: g } = d;
  const isOta = b.source !== "direct" && b.source !== "admin";
  const preview = b.status === "confirmed" && !isOta ? await cancellationPreview(b.id, { by: "hotel", hotelId: hotel.id }) : null;
  const guestQuote = b.status === "confirmed" && !isOta ? await cancellationPreview(b.id, { by: "guest", hotelId: hotel.id }) : null;
  const canNoShow = b.status === "confirmed" && todayIn(hotel.timezone) > b.checkin;

  return (
    <div className="stack">
      <a href={`/admin/${hotel.id}/bookings`}>← Buchungen</a>
      <h1>Buchung {b.reference}</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      {b.overbooked ? <p className="notice warn"><strong>Überbuchung:</strong> Diese Portal-Buchung hat mehr Zimmer belegt als verfügbar sind.</p> : null}
      <div className="card kv">
        <span className="muted">Status</span><span><span className="badge">{b.status}</span></span>
        <span className="muted">Quelle</span><span>{b.source}{b.otaReservationCode ? ` (${b.otaReservationCode})` : ""}</span>
        <span className="muted">Gast</span><span>{g ? <>{g.firstName} {g.lastName} · <a href={`mailto:${g.email}`}>{g.email}</a>{g.phone ? ` · ${g.phone}` : ""}</> : "–"}</span>
        <span className="muted">Aufenthalt</span><span>{b.checkin} → {b.checkout} · {b.adults} Erw.{b.children ? ` + ${b.children} Kinder (${b.childrenAges.join(", ")} J.)` : ""}</span>
        <span className="muted">Zimmer</span><span>{d.roomType?.name ?? "–"} · {d.ratePlan?.name ?? "–"}</span>
        <span className="muted">Preise pro Nacht</span><span>{d.room?.nightlyPrices.map((n) => `${n.night}: ${formatChf(n.price_rappen)}`).join(" · ")}</span>
        <span className="muted">Zimmer total</span><span>{formatChf(b.roomsTotalRappen)}</span>
        <span className="muted">Kurtaxe</span><span>{formatChf(b.touristTaxRappen)}{hotel.touristTaxIncludedInPrice ? " (im Preis inbegriffen)" : ""}</span>
        <span className="muted">Total</span><span><strong>{formatChf(b.totalRappen)}</strong></span>
        {b.voucherRappen > 0 ? (<><span className="muted">davon Gutschein</span><span>{formatChf(b.voucherRappen)} · per Karte/TWINT {formatChf(b.totalRappen - b.voucherRappen)}</span></>) : null}
        <span className="muted">Plattformgebühr</span><span>{formatChf(b.platformFeeRappen)}</span>
        <span className="muted">Bemerkung Gast</span><span>{b.guestNotes ?? "–"}</span>
      </div>

      <h3>Zahlungen</h3>
      <table className="table">
        <thead><tr><th>Status</th><th>Methode</th><th>Betrag</th><th>Gebühr</th><th>Erstattet</th><th>Stripe</th></tr></thead>
        <tbody>
          {d.payments.map((p) => (
            <tr key={p.id}><td>{p.status}</td><td>{p.method ?? "–"}</td><td>{formatChf(p.amountRappen)}</td><td>{formatChf(p.applicationFeeRappen)}</td><td>{formatChf(p.refundedRappen)}</td><td className="small">{p.stripePaymentIntentId ?? p.stripeCheckoutSessionId ?? "–"}</td></tr>
          ))}
        </tbody>
      </table>

      {isOta && b.status === "confirmed" ? <p className="notice warn">Portal-Buchung: Bitte im Portal ({b.source}) stornieren. Die Stornierung kommt dann automatisch hierher.</p> : null}

      {preview?.cancellable && atLeast(role, "manager") ? (
        <form action={cancelAction} className="card stack">
          <h3>Durch das Hotel stornieren</h3>
          <p>Rückerstattung an den Gast: <strong>{formatChf(preview.refundRappen)}</strong> (bei Stornierung durch das Hotel immer voll).</p>
          {guestQuote ? <p className="muted small">Zum Vergleich: Bei Stornierung durch den Gast jetzt {formatChf(guestQuote.refundRappen)} (Gebühr {formatChf(guestQuote.feeRappen)}).</p> : null}
          <input type="hidden" name="hotelId" value={hotel.id} />
          <input type="hidden" name="bookingId" value={b.id} />
          <div><label>Grund (intern)</label><input name="reason" placeholder="z. B. Wasserschaden" /></div>
          <button className="btn danger">Verbindlich stornieren</button>
        </form>
      ) : null}

      {canNoShow ? (
        <form action={noShowAction}>
          <input type="hidden" name="hotelId" value={hotel.id} />
          <input type="hidden" name="bookingId" value={b.id} />
          <button className="btn secondary">Als No-Show markieren</button>
        </form>
      ) : null}

      <h3>Verlauf</h3>
      <table className="table">
        <tbody>
          {d.log.map((l) => (
            <tr key={l.id}><td className="small">{l.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td><td>{l.action}</td><td className="small muted">{l.actor}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
