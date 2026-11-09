import type { Hotel } from "@/src/db/schema";
import { t, type Locale } from "@/src/i18n/dict";
import { env } from "@/src/env";
import { HEX, inkOn, readableOnWhite } from "@/src/domain/brand";
import { tr } from "@/src/domain/blocks";
import { listPages } from "@/src/services/site";
import { fontOf, layoutOf } from "@/src/domain/theme";
import { fontVars } from "./fonts";

/** Rahmen der Hotel-Seiten: Kopf mit Logo, Fusszeile, Erscheinungsbild des Hotels (Farbe, Logo) */
export async function Shell({ hotel, locale, base, path = "", current, children }: { hotel: Hotel; locale: Locale; base: string; path?: string; current?: string; children: React.ReactNode }) {
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
  const nav = bookingOnly ? [] : pages.filter((p) => p.showInNav && p.slug !== "");
  const imprint = pages.find((p) => p.slug === "impressum");
  return (
    <div className={`site layout-${layout}${color ? " branded" : ""}`} style={style}>
      <header className="site-head">
        <div className="wrap">
          <a className="brand" href={homeHref}>
            {brand.logoUrl ? <img className="brand-logo" src={brand.logoUrl} alt={hotel.name} /> : hotel.name}
          </a>
          {nav.length ? (
            <nav className="site-nav" aria-label="Menü">
              <a href={`${base}/${locale}`} aria-current={current === "" ? "page" : undefined}>{locale === "de" ? "Start" : "Home"}</a>
              {nav.map((p) => (
                <a key={p.id} href={`${base}/${locale}/${p.slug}`} aria-current={current === p.slug ? "page" : undefined}>{tr(p.navLabel, locale) || tr(p.title, locale)}</a>
              ))}
            </nav>
          ) : null}
          <nav className="lang" aria-label="Sprache">
            {bookingOnly ? <a href={brand.websiteUrl}>{locale === "de" ? "Zur Website" : "Back to website"}</a> : null}
            {(["de", "en"] as const).map((l) => (
              <a key={l} href={`${base}/${l}${path}`} aria-current={l === locale}>{l.toUpperCase()}</a>
            ))}
          </nav>
        </div>
      </header>
      <main className="wrap">{children}</main>
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
          {imprint ? <><a href={`${base}/${locale}/impressum`}>{locale === "de" ? "Impressum" : "Legal notice"}</a> · </> : null}
          <a href={`${base}/${locale}/agb`}>{locale === "de" ? "AGB" : "Terms"}</a> · <a href={`${base}/${locale}/datenschutz`}>{locale === "de" ? "Datenschutz" : "Privacy"}</a>
          <span className="small"> · {locale === "de" ? "Buchung über" : "Booking by"} {env().PLATFORM_NAME}</span>
        </div>
      </footer>
    </div>
  );
}
