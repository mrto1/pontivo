import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { hotels } from "@/src/db/schema";
import { voucherByToken } from "@/src/services/vouchers";
import { formatChf } from "@/src/domain/money";
import { fill, formatDay, hotelLocales, isLocale, t, type Locale } from "@/src/i18n/dict";
import { Shell } from "@/components/public/Shell";
import { AutoRefresh } from "@/components/public/AutoRefresh";
import { PrintButton } from "@/components/public/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Gutschein ansehen und drucken (Link aus der Mail). Nur bezahlte Gutscheine zeigen den Code. */
export default async function VoucherView({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const v = await voucherByToken(token);
  if (!v) notFound();
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, v.hotelId));
  const want = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : isLocale(v.language) ? (v.language as Locale) : "de";
  const locale: Locale = hotelLocales(hotel).includes(want) ? want : "de";
  const d = t(locale);
  const base = hotel.primaryDomain ? "" : `/h/${hotel.slug}`;
  const logo = hotel.content.brand?.logoUrl;

  return (
    <Shell hotel={hotel} locale={locale} base={base} noBookButton>
      <section style={{ padding: "32px 0" }}>
        {v.status === "pending" ? (<><p className="notice">{d.vPending}</p>{sp.paid ? <AutoRefresh seconds={3} /> : null}</>) : null}
        {v.status === "cancelled" ? <p className="notice warn">{d.paymentAborted}</p> : null}
        {v.status === "paid" ? (
          <>
            {sp.paid ? <p className="notice no-print">{d.vThanks}</p> : null}
            <article className="voucher">
              <div className="voucher-head">
                {logo ? <img src={logo} alt={hotel.name} className="brand-logo" /> : <strong className="brand">{hotel.name}</strong>}
                <span className="voucher-kind">{d.vTitle}</span>
              </div>
              {v.recipientName ? <p className="voucher-for">{v.recipientName}</p> : null}
              <p className="voucher-amount">{formatChf(v.amountRappen)}</p>
              {v.message ? <p className="voucher-msg">«{v.message}»</p> : null}
              {v.buyerName ? <p className="muted small">{d.vFrom} {v.buyerName}</p> : null}
              <div className="voucher-code">
                <span className="small muted">{d.vCode}</span>
                <strong>{v.code}</strong>
              </div>
              <p className="small">{fill(d.vValid, { date: formatDay(v.validUntil, locale) })}{v.remainingRappen < v.amountRappen ? ` · ${d.vRemaining}: ${formatChf(v.remainingRappen)}` : ""}</p>
              <p className="small muted">{d.vRedeem}</p>
              <p className="small muted">{hotel.name}{hotel.addressLine ? ` · ${hotel.addressLine}` : ""}{hotel.city ? ` · ${hotel.postalCode} ${hotel.city}` : ""} · {hotel.contactEmail}{hotel.contactPhone ? ` · ${hotel.contactPhone}` : ""}</p>
            </article>
            <p className="no-print" style={{ marginTop: 16 }}><PrintButton label={d.vPrint} /></p>
          </>
        ) : null}
      </section>
    </Shell>
  );
}
