import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { hotels } from "@/src/db/schema";
import { landingTarget } from "@/src/domain/google-hotels";
import { publicBase } from "@/src/services/brand";

export const dynamic = "force-dynamic";

/**
 * Landingpage für Google Hotelpreise (SPEC 19.70): Google ruft `/g/<Hotel-ID>?checkin=…&checkout=…&adults=…` auf,
 * wir leiten sofort (ohne Zwischenseite) auf die Buchungsseite des Betriebs weiter, mit Reisedaten und Herkunft «google».
 * Die Buchungsseite zeigt dort Zimmer, Preis und Kurtaxe für genau diese Reise.
 */
export async function GET(req: Request, { params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(hotelId)) return new Response("Nicht gefunden", { status: 404 });
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  if (!hotel || hotel.status !== "live" || hotel.propertyType === "restaurant") return new Response("Nicht gefunden", { status: 404 });
  const url = landingTarget({ base: publicBase(hotel), defaultLang: hotel.defaultLanguage, params: new URL(req.url).searchParams });
  return NextResponse.redirect(url, 302);
}
