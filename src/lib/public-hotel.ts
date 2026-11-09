import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getHotelByHost, getHotelBySlug } from "../services/hotels";
import { hotelLocales, isLocale, type Locale } from "../i18n/dict";

/** Seiten unter /[locale]: Hotel über den Host (SPEC 3) */
export async function hotelFromHost(locale: string) {
  if (!isLocale(locale)) notFound();
  const hotel = await getHotelByHost((await headers()).get("host"));
  if (!hotel || !hotelLocales(hotel).includes(locale as Locale)) notFound();
  return { hotel, locale: locale as Locale, base: "" };
}

/** Vorschau /h/<slug>/[locale] (Entwicklung, Vorschau vor Domain-Umstellung) */
export async function hotelFromSlug(slug: string, locale: string) {
  if (!isLocale(locale)) notFound();
  const hotel = await getHotelBySlug(slug);
  if (!hotel || !hotelLocales(hotel).includes(locale as Locale)) notFound();
  return { hotel, locale: locale as Locale, base: `/h/${hotel.slug}` };
}
