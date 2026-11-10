import type { Hotel } from "@/src/db/schema";
import { searchParamsSchema } from "@/src/lib/validation";
import { searchOffers } from "@/src/services/search";
import { isBookable } from "@/src/services/hotels";
import { env } from "@/src/env";
import { addDays, diffDays, todayIn } from "@/src/domain/dates";
import { formatChf } from "@/src/domain/money";
import { fill, formatDay, LOCALE_TAGS, t, type Locale } from "@/src/i18n/dict";
import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { extras as extrasTable, ratePlans } from "@/src/db/schema";
import { extraApplies } from "@/src/domain/extras";
import { tr } from "@/src/domain/blocks";
import { asc } from "drizzle-orm";
import { planName } from "@/src/domain/i18n-names";
import { voucherSettings } from "@/src/services/vouchers";
import { Shell } from "./Shell";
import { SearchBar } from "./SearchBar";
import { BookingForm } from "./BookingForm";

type SP = Record<string, string | string[] | undefined>;

export async function BookPage({ hotel, locale, base, sp }: { hotel: Hotel; locale: Locale; base: string; sp: SP }) {
  const d = t(locale);
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
  const ageList = sp.age ? (Array.isArray(sp.age) ? sp.age : [sp.age]).join(",") : one("ages");
  const parsed = searchParamsSchema.safeParse({ checkin: one("checkin"), checkout: one("checkout"), adults: one("adults"), children: one("children"), ages: ageList });
  const today = todayIn(hotel.timezone);
  const q = parsed.success ? parsed.data : null;
  // Aus dem Baustein «Angebote»: nur dieser Tarif, Nächte vorschlagen
  const planId = /^[0-9a-f-]{36}$/.test(one("plan") ?? "") ? one("plan")! : undefined;
  const plan = planId ? (await db().select().from(ratePlans).where(and(eq(ratePlans.id, planId), eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true))))[0] : undefined;
  const wantNights = Math.min(60, Math.max(1, Number(one("nights")) || plan?.minNights || 2));
  const path = q ? `/book?checkin=${q.checkin}&checkout=${q.checkout}&adults=${q.adults}&children=${q.children}${q.ages.length ? `&ages=${q.ages.join(",")}` : ""}${plan ? `&plan=${plan.id}` : ""}` : "";

  let body: React.ReactNode;
  if (!isBookable(hotel, env().PAYMENT_PROVIDER)) {
    body = <p className="notice warn">{d.notBookable}</p>;
  } else if (!q) {
    body = <p className={`notice ${one("checkin") ? "warn" : ""}`}>{one("checkin") ? d.invalidSearch : d.chooseDates}</p>;
  } else if (plan && diffDays(q.checkin, q.checkout) < plan.minNights) {
    body = <p className="notice warn">{fill(d.offerMinNights, { n: plan.minNights })}</p>;
  } else {
    const res = await searchOffers(hotel, { checkin: q.checkin, checkout: q.checkout, adults: q.adults, children: q.children, childrenAges: q.ages }, { lang: locale, ratePlanId: plan?.id });
    if (!res.ok) {
      body = (
        <p className="notice warn">
          {res.error === "child_ages_required" ? d.childAgesRequired : res.error === "tourist_tax_unconfirmed" ? d.notBookable : d.invalidSearch}
        </p>
      );
    } else if (res.offers.length === 0) {
      // Fester Anreisetag (z. B. Samstag): Gast sagen, an welchen Tagen er anreisen kann
      const days = res.rejected.length && res.rejected.every((r) => r.reason === "closed_to_arrival")
        ? [...new Set((await db().select({ w: ratePlans.arrivalWeekdays }).from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true)))).flatMap((r) => r.w))].sort()
        : [];
      const names = days.map((w) => new Date(Date.UTC(2024, 0, 7 + w)).toLocaleDateString(LOCALE_TAGS[locale], { weekday: "long", timeZone: "UTC" }));
      body = <p className="notice">{names.length ? fill(d.arrivalOnly, { days: names.join(" / ") }) : d.noOffers}</p>;
    } else {
      const n = diffDays(q.checkin, q.checkout);
      const optional = (await db().select().from(extrasTable).where(and(eq(extrasTable.hotelId, hotel.id), eq(extrasTable.active, true), eq(extrasTable.mandatory, false))).orderBy(asc(extrasTable.sortOrder), asc(extrasTable.createdAt)))
        .map((e) => ({ id: e.id, name: tr(e.name, locale), description: tr(e.description, locale), priceRappen: e.priceRappen, unit: e.unit, maxQuantity: e.maxQuantity, mandatory: false, active: true, roomTypeIds: e.roomTypeIds }));
      body = (
        <>
          <h2>{d.offers}</h2>
          <p className="muted">
            {formatDay(q.checkin, locale)} – {formatDay(q.checkout, locale)} · {n} {n === 1 ? d.night : d.nights} · {q.adults} {d.adults}
            {q.children ? `, ${q.children} ${d.children}` : ""}
          </p>
          {res.offers.map((o) => (
            <article key={o.ratePlan.id} className="card offer">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {o.roomType.photos[0] ? <img className="offer-photo" src={o.roomType.photos[0].url} alt={o.roomType.photos[0].alt ?? o.roomType.name} loading="lazy" /> : null}
                <div style={{ flex: "1 1 260px" }}>
                <h3>{o.roomType.name} · {o.ratePlan.name}</h3>
                <p className="small muted">
                  {o.ratePlan.breakfastIncluded ? d.breakfast : d.noBreakfast} · {o.cancellationPolicy}
                </p>
                <table className="rows small">
                  <tbody>
                    <tr><td>{d.roomPrice} ({n} {n === 1 ? d.night : d.nights})</td><td>{formatChf(o.roomsTotalRappen)}</td></tr>
                    {o.mandatoryExtras.map((x) => <tr key={x.name}><td>{x.name}</td><td>{formatChf(x.amountRappen)}</td></tr>)}
                    <tr><td>{d.touristTax}</td><td>{o.touristTaxIncluded ? d.included : formatChf(o.touristTaxRappen)}</td></tr>
                  </tbody>
                </table>
                </div>
              </div>
              <div className="price">
                <div className="muted small">{d.total}</div>
                <div className="big">{formatChf(o.totalRappen)}</div>
              </div>
              <details style={{ gridColumn: "1 / -1" }}>
                <summary className="btn secondary">{d.choose}</summary>
                <BookingForm
                  locale={locale}
                  hotelSlug={hotel.slug}
                  roomTypeId={o.roomType.id}
                  ratePlanId={o.ratePlan.id}
                  checkin={q.checkin}
                  checkout={q.checkout}
                  adults={q.adults}
                  children={q.children}
                  ages={q.ages}
                  base={base}
                  vouchers={voucherSettings(hotel).enabled}
                  extras={optional.filter((e) => extraApplies(e, o.roomType.id))}
                  nights={n}
                  baseTotalRappen={o.totalRappen}
                />
              </details>
            </article>
          ))}
        </>
      );
    }
  }

  return (
    <Shell hotel={hotel} locale={locale} base={base} path={path} noBookButton>
      <div style={{ padding: "24px 0" }}>
        {plan ? <p className="small muted" style={{ margin: "0 0 8px" }}>{d.offerFor}: <strong>{planName(plan, locale)}</strong>{plan.minNights > 1 ? ` · ${fill(d.fromNights, { n: plan.minNights })}` : ""}</p> : null}
        <SearchBar action={`${base}/${locale}/book`} locale={locale} today={today} plan={plan?.id}
          defaults={{ checkin: q?.checkin ?? addDays(today, 1), checkout: q?.checkout ?? addDays(q?.checkin ?? addDays(today, 1), wantNights), adults: q?.adults, children: q?.children, ages: q?.ages }} />
      </div>
      <section>{body}</section>
    </Shell>
  );
}
