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
  const resto = process.env.STATIC_SITE === "1" ? false : await restaurantPublic();
  return {
    title: resto ? `${name} – Direkt buchen, bestellen, reservieren. Ohne Provision.` : `${name} – Direktbuchung für Schweizer Unterkünfte`,
    description: resto
      ? `Website, Direktbuchung, Tischreservation und Online-Bestellung für das Schweizer Gastgewerbe: Unterkünfte und Restaurants. ${feePercentText()} % auf das, was über ${name} läuft.`
      : `Website mit Online-Buchung und TWINT für Schweizer Unterkünfte. ${feePercentText()} % pro Direktbuchung.`,
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
