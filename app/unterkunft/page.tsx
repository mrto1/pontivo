import type { Metadata } from "next";
import { feePercentText } from "@/src/domain/fee";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { hotels } from "@/src/db/schema";
import { getHotelByHost } from "@/src/services/hotels";
import { env } from "@/src/env";
import { PontivoHome } from "@/components/marketing/PontivoHome";
import { resolveSite } from "@/src/domain/pontivo-site";
import { getSiteOverrides } from "@/src/services/platform-site";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/src/domain/fee";
import { accountLink } from "@/src/services/account-link";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const name = env().PLATFORM_NAME;
  return {
    title: `${name} für Unterkünfte – Direktbuchung für Hotels`,
    description: `Website mit Online-Buchung, TWINT und Abgleich mit Booking.com für kleine Hotels in der Schweiz. ${name} kostet ${feePercentText()} % pro Direktbuchung.`,
    alternates: { canonical: "/unterkunft" },
  };
}

/** Seite für Unterkünfte (SPEC 20.9): die bisherige Hotel-Startseite, Texte unter Plattform-Verwaltung → Website-Texte */
export default async function Unterkunft() {
  if (await getHotelByHost((await headers()).get("host"))) notFound(); // Domain eines Hotels: keine Plattform-Seiten
  const e = env();
  // ASSUMPTION: Das Demo-Hotel (Slug DEMO_HOTEL_SLUG) wird als Beispiel verlinkt, wenn es existiert und live ist.
  const [demo] = await db().select().from(hotels).where(eq(hotels.slug, e.DEMO_HOTEL_SLUG));
  const list = e.NODE_ENV === "production" || process.env.STATIC_SITE === "1" ? [] : await db().select().from(hotels).orderBy(hotels.name);
  return (
    <PontivoHome
      account={process.env.STATIC_SITE === "1" ? null : await accountLink()}
      site={resolveSite(await getSiteOverrides(), { name: e.PLATFORM_NAME, fee: DEFAULT_PLATFORM_FEE_BPS / 100, email: e.PLATFORM_CONTACT_EMAIL })}
      contact={{
        name: e.PLATFORM_NAME,
        email: e.PLATFORM_CONTACT_EMAIL,
        phone: e.PLATFORM_PHONE,
        staticSite: process.env.STATIC_SITE === "1",
        demoUrl: demo?.status === "live" ? `/h/${demo.slug}/de` : undefined,
      }}
    >
      {list.length ? (
        <p>
          Entwicklung: {list.map((h, i) => <span key={h.id}>{i ? " · " : ""}<a href={`/h/${h.slug}/de`}>{h.name}</a></span>)} · <a href="/admin">Admin</a>
        </p>
      ) : null}
    </PontivoHome>
  );
}
