import type { Hotel, SitePage } from "@/src/db/schema";
import { tr } from "@/src/domain/blocks";
import type { Locale } from "@/src/i18n/dict";
import { Shell } from "./Shell";
import { Blocks } from "./Blocks";
import { faqJsonLd, ldJson, restaurantJsonLd } from "@/src/lib/structured-data";
import { publicBase } from "@/src/services/brand";
import { resolveBlocks } from "@/src/services/site-data";

export async function SitePageView({ hotel, page, locale, base }: { hotel: Hotel; page: SitePage; locale: Locale; base: string }) {
  const blocks = await resolveBlocks(hotel, page.blocks); // Speisekarte und Öffnungszeiten aus dem Betrieb (SPEC 20.7)
  const faq = faqJsonLd(blocks, locale);
  const restaurant = restaurantJsonLd(hotel, blocks, locale, `${publicBase(hotel)}/${locale}${page.slug ? `/${page.slug}` : ""}`);
  return (
    <Shell hotel={hotel} locale={locale} base={base} path={page.slug ? `/${page.slug}` : ""} current={page.slug}>
      {restaurant ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(restaurant) }} /> : null}
      {faq ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faq) }} /> : null}
      <Blocks blocks={blocks} hotel={hotel} lang={locale} base={base} pageTitle={page.slug ? tr(page.title, locale) : ""} pageSlug={page.slug} />
    </Shell>
  );
}
