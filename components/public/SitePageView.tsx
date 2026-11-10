import type { Hotel, SitePage } from "@/src/db/schema";
import { tr } from "@/src/domain/blocks";
import type { Locale } from "@/src/i18n/dict";
import { Shell } from "./Shell";
import { Blocks } from "./Blocks";
import { faqJsonLd, ldJson, restaurantJsonLd } from "@/src/lib/structured-data";
import { publicBase } from "@/src/services/brand";

export function SitePageView({ hotel, page, locale, base }: { hotel: Hotel; page: SitePage; locale: Locale; base: string }) {
  const faq = faqJsonLd(page.blocks, locale);
  const restaurant = restaurantJsonLd(hotel, page.blocks, locale, `${publicBase(hotel)}/${locale}${page.slug ? `/${page.slug}` : ""}`);
  return (
    <Shell hotel={hotel} locale={locale} base={base} path={page.slug ? `/${page.slug}` : ""} current={page.slug}>
      {restaurant ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(restaurant) }} /> : null}
      {faq ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faq) }} /> : null}
      <Blocks blocks={page.blocks} hotel={hotel} lang={locale} base={base} pageTitle={page.slug ? tr(page.title, locale) : ""} pageSlug={page.slug} />
    </Shell>
  );
}
