/**
 * Testbetrieb für die Channex-Zertifizierung anlegen (Vorgaben Channex: «Test Property - <Anbieter>», USD,
 * Twin Room und Double Room mit je «Best Available Rate» (100) und «Bed & Breakfast» (120)).
 *   node --import tsx scripts/channex-cert-property.ts du@pontivo.ch [--property <uuid> --twin <uuid> --double <uuid>
 *        --twin-bar <uuid> --twin-bb <uuid> --double-bar <uuid> --double-bb <uuid>]
 * Mit den IDs wird die bestehende Staging-Property zugeordnet, sonst im Admin «In Channex anlegen».
 * Danach im Admin unter Channex «Abgleich einschalten» (= Vollabgleich).
 * Nur für Staging/Tests: eigene Gemeinde «Pontivo-Test» ohne Kurtaxe, damit keine echte Gemeinde-Regel geändert wird.
 */
import { eq } from "drizzle-orm";
import { db, closeDb } from "../src/db/client";
import { hotelMembers, hotels, ratePlans, roomTypes, touristTaxRules, users } from "../src/db/schema";
import { createUser } from "../src/services/setup";
import { createRatePlan, createRoomType } from "../src/services/rooms";
import { setBlocked, updateRatesBatch, type RateRow } from "../src/services/inventory";
import { addDays, todayIn } from "../src/domain/dates";
import { newPublicToken } from "../src/domain/ids";

const args = process.argv.slice(2);
const email = args.find((a) => a.includes("@"));
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!email) {
  console.error("Aufruf: node --import tsx scripts/channex-cert-property.ts du@pontivo.ch [--property … --twin … --double … --twin-bar … --twin-bb … --double-bar … --double-bb …]");
  process.exit(1);
}

const TZ = "Europe/Zurich";
const today = todayIn(TZ);
const actor = "setup:channex-cert";

const [hotel] = await db().insert(hotels).values({
  slug: `channex-test-${newPublicToken().slice(0, 6).toLowerCase()}`,
  name: "Test Property - Pontivo",
  canton: "ZH", municipality: "Pontivo-Test", city: "Henggart", postalCode: "8444", addressLine: "Teststrasse 1",
  contactEmail: email, currency: "USD", timezone: TZ, status: "draft", propertyType: "hotel",
  onboarding: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
  channexPropertyId: opt("property") ?? null,
}).returning();
// Kurtaxe-Regel nur für die Testgemeinde (keine echte Gemeinde betroffen)
await db().insert(touristTaxRules).values({
  canton: "ZH", municipality: "Pontivo-Test", validFrom: today, category: hotel.touristTaxCategory,
  adultRappen: 0, reducedRappen: null, freeUnderAge: 0, reducedUnderAge: null, status: "none", notes: "Testbetrieb Channex", checkedAt: today,
}).onConflictDoNothing();
// Bestehenden Benutzer nicht verändern (Name, Admin-Recht bleiben)
const [existing] = await db().select().from(users).where(eq(users.email, email.toLowerCase()));
const user = existing ?? (await createUser(email));
await db().insert(hotelMembers).values({ hotelId: hotel.id, userId: user.id, role: "owner" }).onConflictDoNothing();

const rt = (name: string, roomCount: number, i: number) =>
  createRoomType(hotel.id, { name, description: null, roomCount, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, sortOrder: i, active: true }, actor);
const rp = (rtId: string, name: string, price: number, breakfast: boolean) =>
  createRatePlan(hotel.id, rtId, { name, breakfastIncluded: breakfast, freeCancelHours: 48, cancelFeeBps: 10000, baseOccupancy: 2, extraAdultRappen: 0, singleDiscountRappen: 0, active: true }, price, actor);
const twin = await rt("Twin Room", 8, 0);
const dbl = await rt("Double Room", 5, 1);
const p = {
  twinBar: await rp(twin.id, "Best Available Rate", 10000, false),
  twinBb: await rp(twin.id, "Bed & Breakfast", 12000, true),
  dblBar: await rp(dbl.id, "Best Available Rate", 10000, false),
  dblBb: await rp(dbl.id, "Bed & Breakfast", 12000, true),
};

// Realistische, abwechslungsreiche Werte (Channex: keine Einheitswerte)
const end = addDays(today, 547);
const r = (id: string, from: string, to: string, change: RateRow["change"]): RateRow => ({ ratePlanId: id, from, to, change });
await updateRatesBatch(hotel.id, [r(p.twinBar.id, today, end, { priceRappen: 11900 }), r(p.twinBb.id, today, end, { priceRappen: 13900 }), r(p.dblBar.id, today, end, { priceRappen: 12900 }), r(p.dblBb.id, today, end, { priceRappen: 14900 })], { actor });
await updateRatesBatch(hotel.id, [r(p.twinBar.id, today, end, { priceRappen: 13900, minStayArrival: 2 }), r(p.twinBb.id, today, end, { priceRappen: 15900, minStayArrival: 2 }), r(p.dblBar.id, today, end, { priceRappen: 14900 }), r(p.dblBb.id, today, end, { priceRappen: 16900 })], { actor, weekdays: [5, 6] });
await updateRatesBatch(hotel.id, [
  r(p.twinBar.id, addDays(today, 40), addDays(today, 54), { priceRappen: 18900, minStayArrival: 3 }),
  r(p.dblBar.id, addDays(today, 40), addDays(today, 54), { priceRappen: 19900, minStayArrival: 3 }),
  r(p.twinBb.id, addDays(today, 90), addDays(today, 110), { priceRappen: 17500 }),
  r(p.twinBar.id, addDays(today, 150), addDays(today, 163), { stopSell: true }),
  r(p.dblBb.id, addDays(today, 200), addDays(today, 290), { maxStay: 14, priceRappen: 17900 }),
], { actor });
await setBlocked(hotel.id, twin.id, addDays(today, 3), addDays(today, 9), 2, { actor });
await setBlocked(hotel.id, dbl.id, addDays(today, 150), addDays(today, 163), 5, { actor });
await setBlocked(hotel.id, twin.id, addDays(today, 230), addDays(today, 260), 3, { actor });

// Optional: bestehende Channex-IDs zuordnen
const map: [string, string | undefined, "rt" | "rp"][] = [
  [twin.id, opt("twin"), "rt"], [dbl.id, opt("double"), "rt"],
  [p.twinBar.id, opt("twin-bar"), "rp"], [p.twinBb.id, opt("twin-bb"), "rp"], [p.dblBar.id, opt("double-bar"), "rp"], [p.dblBb.id, opt("double-bb"), "rp"],
];
for (const [id, cx, kind] of map) {
  if (!cx) continue;
  if (kind === "rt") await db().update(roomTypes).set({ channexRoomTypeId: cx }).where(eq(roomTypes.id, id));
  else await db().update(ratePlans).set({ channexRatePlanId: cx }).where(eq(ratePlans.id, id));
}

console.log(`Testbetrieb angelegt: ${hotel.name} (${hotel.id}), Inhaber ${email}`);
console.log(`Admin: /admin/${hotel.id}  → Channex → ${opt("property") ? "Abgleich einschalten" : "In Channex anlegen, dann Abgleich einschalten"}`);
await closeDb();
