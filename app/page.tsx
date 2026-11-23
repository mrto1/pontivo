import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getHotelByHost } from "@/src/services/hotels";
import { env } from "@/src/env";
import { PortalHome } from "@/components/marketing/PortalHome";
import { feePercentText } from "@/src/domain/fee";
import { formatChf } from "@/src/domain/money";
import { DEFAULT_MONTHLY_MINIMUM_RAPPEN } from "@/src/legal/host-terms";
import { accountLink } from "@/src/services/account-link";
import { restaurantPublic } from "@/src/services/platform-settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const name = env().PLATFORM_NAME;
  // Keine Aussage «ohne Provision»: wir nehmen einen Prozentsatz pro Buchung oder Bestellung (SPEC 20.9). Gegenüber Portalen: «Statt Portal-Provision».
  return {
    title: `${name} – Direkt buchen, reservieren, bestellen. Statt Portal-Provision.`,
    description: `Gäste buchen Zimmer, reservieren Tische und bestellen direkt bei Ihnen, mit TWINT oder Karte. Eigene Website inklusive, nur ${feePercentText()} % auf das, was über ${name} läuft. Für Schweizer Hotels, B&Bs und Restaurants.`,
  };
}

/** Startseite der Dachmarke (SPEC 20.9). Domain eines Hotels → dessen Website. */
export default async function Root() {
  const hotel = await getHotelByHost((await headers()).get("host"));
  if (hotel) redirect(`/${hotel.defaultLanguage}`);
  const e = env();
  const st = process.env.STATIC_SITE === "1";
  return (
    <PortalHome
      contact={{ name: e.PLATFORM_NAME, email: e.PLATFORM_CONTACT_EMAIL, phone: e.PLATFORM_PHONE, staticSite: st }}
      account={st ? null : await accountLink()}
      restaurant={await restaurantPublic()}
      fee={feePercentText()}
      minimum={formatChf(DEFAULT_MONTHLY_MINIMUM_RAPPEN).replace(".00", "")}
    />
  );
}
