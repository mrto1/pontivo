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

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const name = env().PLATFORM_NAME;
  return {
    title: `${name} – Direktbuchungen, Reservationen und Bestellungen für Schweizer Gastgeber`,
    description: `Gäste buchen, bestellen und reservieren direkt bei Ihrem Hotel, B&B oder Restaurant – mit TWINT, Karte oder bar. Nur ${feePercentText()} % pro Buchung und Bestellung.`,
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
      fee={feePercentText()}
      minimum={formatChf(DEFAULT_MONTHLY_MINIMUM_RAPPEN).replace(".00", "")}
    />
  );
}
