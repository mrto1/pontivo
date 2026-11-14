import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { ROLE_LABEL, type Role } from "../domain/roles";
import { hotelMembers, hotels, touristTaxRules, users, type Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";
import { env } from "../env";
import { audit } from "./audit";
import { taxRuleFor } from "./hotels";

export const hotelSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional().nullable(),
  addressLine: z.string().trim().max(200).optional().nullable(),
  postalCode: z.string().trim().max(10).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  contactEmail: z.string().trim().email(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  checkinTime: z.string().regex(/^\d{2}:\d{2}$/),
  checkoutTime: z.string().regex(/^\d{2}:\d{2}$/),
  defaultLanguage: z.enum(["de", "en"]),
  touristTaxIncludedInPrice: z.boolean(),
  headlineDe: z.string().max(200).optional().nullable(),
  introDe: z.string().max(2000).optional().nullable(),
  headlineEn: z.string().max(200).optional().nullable(),
  introEn: z.string().max(2000).optional().nullable(),
});

export async function updateHotelSettings(hotel: Hotel, input: z.infer<typeof hotelSettingsSchema>, actor: string) {
  const v = hotelSettingsSchema.parse(input);
  const content = {
    ...hotel.content,
    de: { headline: v.headlineDe || undefined, intro: v.introDe || undefined },
    en: { headline: v.headlineEn || undefined, intro: v.introEn || undefined },
  };
  await db().transaction(async (tx) => {
    await tx
      .update(hotels)
      .set({
        name: v.name, legalName: v.legalName || null, addressLine: v.addressLine || null, postalCode: v.postalCode || null, city: v.city || null,
        contactEmail: v.contactEmail, contactPhone: v.contactPhone || null, checkinTime: v.checkinTime, checkoutTime: v.checkoutTime,
        defaultLanguage: v.defaultLanguage, touristTaxIncludedInPrice: v.touristTaxIncludedInPrice, content, updatedAt: new Date(),
      })
      .where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "hotel.update", entity: "hotel", entityId: hotel.id });
  });
}

/** SPEC 5.2: Hotel bestätigt den Kurtaxe-Satz → eigene Zeile mit status 'verified', gültig ab heute */
export async function confirmTouristTax(
  hotel: Hotel,
  v: { adultRappen: number; reducedRappen: number | null; freeUnderAge: number; reducedUnderAge: number | null; notes?: string },
  actor: string,
) {
  if (!hotel.municipality) throw new Error("Gemeinde fehlt");
  for (const n of [v.adultRappen, v.freeUnderAge]) if (!Number.isSafeInteger(n) || n < 0) throw new Error("Ungültiger Wert");
  const today = todayIn(hotel.timezone);
  await db().transaction(async (tx) => {
    await tx
      .insert(touristTaxRules)
      .values({
        canton: hotel.canton, municipality: hotel.municipality!, validFrom: today, category: hotel.touristTaxCategory,
        adultRappen: v.adultRappen, reducedRappen: v.reducedRappen, freeUnderAge: v.freeUnderAge, reducedUnderAge: v.reducedUnderAge,
        status: v.adultRappen === 0 ? "none" : "verified", notes: `Vom Hotel bestätigt. ${v.notes ?? ""}`.trim(), checkedAt: today,
      })
      .onConflictDoUpdate({
        target: [touristTaxRules.canton, touristTaxRules.municipality, touristTaxRules.category, touristTaxRules.validFrom],
        set: { adultRappen: v.adultRappen, reducedRappen: v.reducedRappen, freeUnderAge: v.freeUnderAge, reducedUnderAge: v.reducedUnderAge, status: v.adultRappen === 0 ? "none" : "verified", checkedAt: today },
      });
    await audit(tx, { hotelId: hotel.id, actor, action: "tourist_tax.confirm", entity: "hotel", entityId: hotel.id, details: v });
  });
}

/** Voraussetzungen, damit ein Hotel live gehen darf */
export async function goLiveProblems(hotel: Hotel): Promise<string[]> {
  const problems: string[] = [];
  if (env().PAYMENT_PROVIDER === "stripe" && !(hotel.stripeAccountId && hotel.stripeChargesEnabled)) {
    problems.push("Stripe-Konto ist noch nicht freigeschaltet (charges_enabled).");
  }
  const rule = await taxRuleFor(hotel, todayIn(hotel.timezone));
  if (!rule || (rule.status === "needs_confirmation") || (rule.adultRappen === null)) {
    problems.push("Kurtaxe-Satz für die Gemeinde ist nicht bestätigt.");
  }
  return problems;
}

export async function setHotelStatus(hotel: Hotel, status: "live" | "paused" | "draft", actor: string) {
  if (status === "live") {
    const p = await goLiveProblems(hotel);
    if (p.length) throw new Error(p.join(" "));
  }
  await db().update(hotels).set({ status, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "hotel.status", entity: "hotel", entityId: hotel.id, details: { status } });
}

export async function listMembers(hotelId: string) {
  return db()
    .select({ user: users, role: hotelMembers.role })
    .from(hotelMembers)
    .innerJoin(users, eq(users.id, hotelMembers.userId))
    .where(eq(hotelMembers.hotelId, hotelId));
}

export async function addMember(hotelId: string, email: string, role: Role, actor: string) {
  if (!(role in ROLE_LABEL)) throw new Error("Unbekannte Rolle.");
  const e = z.string().trim().email().parse(email).toLowerCase();
  const [u] = await db().insert(users).values({ email: e }).onConflictDoUpdate({ target: users.email, set: { email: e } }).returning();
  await db().insert(hotelMembers).values({ hotelId, userId: u.id, role }).onConflictDoUpdate({ target: [hotelMembers.hotelId, hotelMembers.userId], set: { role } });
  await audit(db(), { hotelId, actor, action: "member.add", entity: "user", entityId: u.id, details: { email: e, role } });
}

export async function removeMember(hotelId: string, userId: string, actor: string) {
  await db().delete(hotelMembers).where(and(eq(hotelMembers.hotelId, hotelId), eq(hotelMembers.userId, userId)));
  await audit(db(), { hotelId, actor, action: "member.remove", entity: "user", entityId: userId });
}

/** Anzahlung (SPEC 5.9): Prozent 10–100 (100 = ganze Summe sofort), Rest fällig 1–60 Tage vor Anreise */
export const depositSchema = z.object({ percent: z.number().int().min(10, "Mindestens 10 %").max(100, "Höchstens 100 %"), dueDays: z.number().int().min(1, "Mindestens 1 Tag").max(60, "Höchstens 60 Tage") });

export async function setDeposit(hotel: Hotel, input: z.infer<typeof depositSchema>, actor: string) {
  const v = depositSchema.parse(input);
  await db().transaction(async (tx) => {
    await tx.update(hotels).set({ depositBps: v.percent * 100, balanceDueDays: v.dueDays, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "hotel.deposit", entity: "hotel", entityId: hotel.id, details: { percent: v.percent, dueDays: v.dueDays } });
  });
}
