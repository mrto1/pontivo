import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireHotel } from "@/src/auth/guard";
import { getPage } from "@/src/services/site";
import { publicBase } from "@/src/services/brand";
import { SitePageView } from "@/components/public/SitePageView";
import { isLocale, type Locale } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vorschau", robots: { index: false, follow: false } };

/** Vorschau für den Website-Editor: zeigt die Seite wie für Gäste, auch Entwürfe. Nur für angemeldete Mitarbeitende des Hotels. */
export default async function Preview({ params, searchParams }: { params: Promise<{ hotelId: string; pageId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { hotelId, pageId } = await params;
  const { lang } = await searchParams;
  const { hotel } = await requireHotel(hotelId);
  const page = await getPage(hotel.id, pageId);
  if (!page) notFound();
  return <SitePageView hotel={hotel} page={page} locale={isLocale(lang ?? "") ? (lang as Locale) : "de"} base={publicBase(hotel)} />;
}
