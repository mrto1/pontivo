import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getHotelByHost } from "@/src/services/hotels";
import { env } from "@/src/env";
import { RestaurantHome } from "@/components/marketing/RestaurantHome";
import { DEFAULT_PLATFORM_FEE_BPS, feePercentText } from "@/src/domain/fee";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import { DEFAULT_MONTHLY_MINIMUM_RAPPEN } from "@/src/legal/host-terms";
import { accountLink } from "@/src/services/account-link";
import { restaurantPublic } from "@/src/services/platform-settings";
import { currentUserId } from "@/src/auth/guard";
import { getUser } from "@/src/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const name = env().PLATFORM_NAME;
  const on = await restaurantPublic();
  return {
    title: `${name} für Restaurants – Website, Reservation, Online-Bestellung und Kasse`,
    description: `Website, Tischreservation, Online-Bestellung mit Abholung und Lieferung und Kasse in einem System, aus der Schweiz, mit TWINT. ${feePercentText()} % pro Online-Bestellung, ohne Gebühr pro Gast.`,
    alternates: { canonical: "/restaurant" },
    ...(on ? {} : { robots: { index: false, follow: false } }),
  };
}

/** Seite für Restaurants (SPEC 20.9). Vor der Freischaltung nur für Plattform-Admins sichtbar (Entwurf, nicht verlinkt). */
export default async function Restaurant() {
  if (await getHotelByHost((await headers()).get("host"))) notFound();
  const on = await restaurantPublic();
  if (!on) {
    const id = await currentUserId();
    const user = id ? await getUser(id) : null;
    if (!user?.isPlatformAdmin) notFound();
  }
  const e = env();
  const st = process.env.STATIC_SITE === "1";
  return (
    <RestaurantHome
      contact={{ name: e.PLATFORM_NAME, email: e.PLATFORM_CONTACT_EMAIL, phone: e.PLATFORM_PHONE, staticSite: st }}
      account={st ? null : await accountLink()}
      draft={!on}
      fee={feePercentText()}
      feeBps={DEFAULT_PLATFORM_FEE_BPS}
      minimum={formatChf(DEFAULT_MONTHLY_MINIMUM_RAPPEN).replace(".00", "")}
      today={todayIn("Europe/Zurich")}
    />
  );
}
