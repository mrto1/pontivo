import { notFound } from "next/navigation";
import { checkinContext } from "@/src/services/guests";
import { isLocale, type Locale } from "@/src/i18n/dict";
import { CI } from "@/src/i18n/checkin";
import { countryOptions } from "@/src/domain/countries";
import { Shell } from "@/components/public/Shell";
import { CheckinForm } from "@/components/public/CheckinForm";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function Checkin({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ctx = await checkinContext(token);
  if (!ctx || !ctx.open) notFound();
  const { booking, hotel, rule, guest } = ctx;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : isLocale(booking.language) ? booking.language : "de";
  const base = hotel.primaryDomain ? "" : `/h/${hotel.slug}`;
  return (
    <Shell hotel={hotel} locale={locale} base={base} noBookButton>
      <section style={{ padding: "32px 0" }}>
        <h1>{CI[locale].title}</h1>
        <p className="muted">{booking.reference} · {booking.checkin} – {booking.checkout}</p>
        <CheckinForm
          token={token} locale={locale} hotelName={hotel.name} persons={ctx.persons} groupMode={ctx.groupMode}
          signatureRequired={rule.signatureRequired} submitted={ctx.submitted} verified={ctx.verified}
          retentionYears={rule.retentionYears} countries={countryOptions(locale)}
          prefill={{ firstName: guest?.firstName ?? "", lastName: guest?.lastName ?? "" }}
        />
      </section>
    </Shell>
  );
}
