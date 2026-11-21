/** Seed-Daten (SPEC 12.6): Hotel "Demo Gasthof", Glarus, 3 Zimmertypen × 2 Ratepläne + Admin-Benutzer. */
import { eq } from "drizzle-orm";
import { db, closeDb } from "../src/db/client";
import { hotels } from "../src/db/schema";
import { createHotelWithRooms, createUser } from "../src/services/setup";

export const DEMO = {
  slug: "demo-gasthof",
  name: "Demo Gasthof",
  canton: "GL",
  municipality: "Glarus",
  contactEmail: "hotel@demo-gasthof.example",
  // http://demo-gasthof.localhost:3000 löst in Browsern ohne Konfiguration auf 127.0.0.1 auf
  primaryDomain: "demo-gasthof.localhost",
  status: "live" as const,
  weekendSurchargeRappen: 2000,
  saturdayMinStay: 2,
  content: {
    de: { headline: "Willkommen im Demo Gasthof", intro: "Ruhige Zimmer mitten in Glarus. Direkt buchen lohnt sich: bester Preis, Zahlung mit TWINT oder Karte." },
    en: { headline: "Welcome to Demo Gasthof", intro: "Quiet rooms in the heart of Glarus. Book direct for the best price, pay with TWINT or card." },
  },
  rooms: [
    { name: "Einzelzimmer", description: "Gemütliches Einzelzimmer mit Dusche/WC.", roomCount: 4, maxAdults: 1, maxChildren: 0, maxOccupancy: 1, basePriceRappen: 12000 },
    { name: "Doppelzimmer", description: "Doppelzimmer mit Blick auf den Glärnisch.", roomCount: 8, maxAdults: 2, maxChildren: 1, maxOccupancy: 2, basePriceRappen: 18000 },
    { name: "Familienzimmer", description: "Grosses Zimmer für bis zu 4 Personen.", roomCount: 2, maxAdults: 4, maxChildren: 3, maxOccupancy: 4, basePriceRappen: 26000 },
  ],
};

async function main() {
  const [existing] = await db().select().from(hotels).where(eq(hotels.slug, DEMO.slug));
  if (existing) {
    console.log("Demo Gasthof existiert bereits:", existing.id);
  } else {
    const { hotel } = await createHotelWithRooms(DEMO);
    console.log("Hotel angelegt:", hotel.name, hotel.id);
    const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.ch";
    await createUser(email, { name: "Admin", platformAdmin: true, hotelId: hotel.id, role: "owner" });
    console.log("Admin-Benutzer:", email, "(Login unter /admin/login)");
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
