import type { Hotel } from "@/src/db/schema";
import { hotelLocales, LOCALE_NAMES, t, type Locale } from "@/src/i18n/dict";
import { env } from "@/src/env";
import { HEX, inkOn, readableOnWhite } from "@/src/domain/brand";
import { tr } from "@/src/domain/blocks";
import { listPages } from "@/src/services/site";
import { fontOf, layoutOf } from "@/src/domain/theme";
import { fontVars } from "./fonts";
import { hotelJsonLd, ldJson } from "@/src/lib/structured-data";
import { publicBase } from "@/src/services/brand";
import { addDays, todayIn } from "@/src/domain/dates";

/** Rahmen der Hotel-Seiten: Kopf mit Logo, Fusszeile, Erscheinungsbild des Hotels (Farbe, Logo) */
export async function Shell({ hotel, locale, base, path = "", current, noBookButton, children }: { hotel: Hotel; locale: Locale; base: string; path?: string; current?: string; noBookButton?: boolean; children: React.ReactNode }) {
  const d = t(locale);
  const brand = hotel.content?.brand ?? {};
  const color = brand.color && HEX.test(brand.color) ? brand.color : null;
  const bookingOnly = brand.mode === "booking_only" && !!brand.websiteUrl;
  const layout = layoutOf(brand.layout);
  const style = {
    ...fontVars(fontOf(brand.font)),
    ...(color ? { "--brand": color, "--brand-ink": inkOn(color), "--brand-link": readableOnWhite(color) } : {}),
  } as React.CSSProperties;
  const homeHref = bookingOnly ? brand.websiteUrl! : `${base}/${locale}`;
  const pages = (await listPages(hotel.id)).filter((p) => p.published);
  const jsonLd = await hotelJsonLd(hotel, locale, publicBase(hotel), pages);
  // Fester «Jetzt buchen»-Knopf auf dem Handy (nicht auf Buchungs- und Gutscheinseiten)
  const today = todayIn(hotel.timezone);
  const bookHref = `${base}/${locale}/book?checkin=${addDays(today, 1)}&checkout=${addDays(today, 3)}&adults=2`;
  const showBook = !noBookButton && hotel.status === "live";
  const langs = hotelLocales(hotel);
  const nav = bookingOnly ? [] : pages.filter((p) => p.showInNav && p.slug !== "");
  const imprint = pages.find((p) => p.slug === "impressum");
  return (
    <div className={`site layout-${layout}${color ? " branded" : ""}`} style={style} lang={locale}>
      <header className="site-head">
        <div className="wrap">
          <a className="brand" href={homeHref}>
            {brand.logoUrl ? <img className="brand-logo" src={brand.logoUrl} alt={hotel.name} /> : hotel.name}
          </a>
          {nav.length ? (
            <nav className="site-nav" aria-label={d.menu}>
              <a href={`${base}/${locale}`} aria-current={current === "" ? "page" : undefined}>{d.home}</a>
              {nav.map((p) => (
                <a key={p.id} href={`${base}/${locale}/${p.slug}`} aria-current={current === p.slug ? "page" : undefined}>{tr(p.navLabel, locale) || tr(p.title, locale)}</a>
              ))}
            </nav>
          ) : null}
          <nav className="lang" aria-label={d.language}>
            {bookingOnly ? <a href={brand.websiteUrl}>{d.backToWebsite}</a> : null}
            {langs.length > 1 ? langs.map((l) => (
              <a key={l} href={`${base}/${l}${path}`} aria-current={l === locale} hrefLang={l} lang={l} title={LOCALE_NAMES[l]}>{l.toUpperCase()}</a>
            )) : null}
          </nav>
        </div>
      </header>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }} />
      <main className="wrap">{children}</main>
      {showBook ? <a className="sticky-book btn" href={bookHref}>{d.bookNow}</a> : null}
      <footer className="foot">
        <div className="wrap">
          <strong>{hotel.name}</strong>
          {hotel.addressLine ? <> · {hotel.addressLine}</> : null}
          {hotel.city ? <> · {hotel.postalCode} {hotel.city}</> : null}
          <br />
          {d.contact}: <a href={`mailto:${hotel.contactEmail}`}>{hotel.contactEmail}</a>
          {hotel.contactPhone ? <> · {hotel.contactPhone}</> : null}
          {bookingOnly ? <> · <a href={brand.websiteUrl}>{brand.websiteUrl!.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></> : null}
          <br />
          {imprint ? <><a href={`${base}/${locale}/impressum`}>{d.imprint}</a> · </> : null}
          <a href={`${base}/${locale}/agb`}>{d.termsShort}</a> · <a href={`${base}/${locale}/datenschutz`}>{d.privacyShort}</a>
          <span className="small"> · {d.bookingBy} {env().PLATFORM_NAME}</span>
        </div>
      </footer>
    </div>
  );
}
