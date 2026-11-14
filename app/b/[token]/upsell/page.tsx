import { notFound } from "next/navigation";
import { getBookingByToken } from "@/src/services/bookings";
import { offerForBooking } from "@/src/services/upsell";
import { formatChf } from "@/src/domain/money";
import { perPerson } from "@/src/domain/extras";
import { tr } from "@/src/domain/blocks";
import { isLocale, type Locale } from "@/src/i18n/dict";
import { U } from "@/src/i18n/upsell";
import { Shell } from "@/components/public/Shell";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Extras nach der Buchung (SPEC 14d): erreichbar nur über den persönlichen Buchungslink */
export default async function UpsellPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const found = await getBookingByToken(token);
  if (!found) notFound();
  const { booking, hotel } = found;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : isLocale(booking.language) ? booking.language : "de";
  const u = U[locale];
  const base = hotel.primaryDomain ? "" : `/h/${hotel.slug}`;
  const offer = await offerForBooking(token);
  const unitLabel = { per_booking: u.perBooking, per_night: u.perNight, per_person: u.perPerson, per_person_night: u.perPersonNight } as const;

  return (
    <Shell hotel={hotel} locale={locale} base={base}>
      <section style={{ padding: "32px 0" }}>
        <h1>{u.title}</h1>
        {sp.paid ? <p className="notice">{u.thanks}</p> : null}
        {sp.empty ? <p className="notice warn">{u.noteIncluded}</p> : null}
        {!offer ? <p className="muted">{sp.paid ? "" : u.unavailable}</p> : (
          <form method="post" action={`/b/${token}/upsell/buy`} className="stack">
            <p className="muted">{u.intro}</p>
            <div className="card">
              <table className="rows">
                <tbody>
                  {offer.items.map((it) => {
                    const max = perPerson(it.unit) ? offer.persons : it.maxQuantity;
                    const desc = tr(it.description, locale);
                    return (
                      <tr key={it.id}>
                        <td>
                          <strong>{tr(it.name, locale)}</strong>
                          {desc ? <><br /><span className="muted small">{desc}</span></> : null}
                          <br /><span className="small">{formatChf(it.priceRappen)} {unitLabel[it.unit]}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <label className="small" htmlFor={`q_${it.id}`}>{u.qty}</label>{" "}
                          <select id={`q_${it.id}`} name={`q_${it.id}`} defaultValue="0">
                            {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <input type="hidden" name="lang" value={locale} />
            <div><button className="btn">{u.pay}</button></div>
          </form>
        )}
        <p><a href={`/b/${token}?lang=${locale}`}>{u.back}</a></p>
      </section>
    </Shell>
  );
}
