import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotelMembers, hotels, ratePlans, roomTypes, sitePages, users, type Hotel } from "../db/schema";
import { slugify } from "../domain/blocks";
import { DEFAULT_MONTHLY_MINIMUM_RAPPEN, HOST_TERMS_VERSION } from "../legal/host-terms";
import { enqueueEmail } from "../email/enqueue";
import { requestLoginLink } from "../auth/session";
import { env } from "../env";
import { audit } from "./audit";
import { goLiveProblems, setHotelStatus } from "./settings";
import { createRatePlan, createRoomType } from "./rooms";
import { createExtra } from "./extras";
import { ensureHomePage } from "./site";

/**
 * Selbst-Registrierung und Einrichtungs-Assistent (für alle Objektarten).
 * Der Fortschritt wird aus den Daten abgeleitet, nicht separat gespeichert: wer etwas im normalen Admin
 * einrichtet, sieht den Schritt im Assistenten ebenfalls als erledigt.
 */

export const PROPERTY_TYPES = ["hotel", "bnb", "apartment", "chalet", "group_house"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_LABEL: Record<PropertyType, string> = {
  hotel: "Hotel / Gasthof", bnb: "Bed & Breakfast", apartment: "Ferienwohnung", chalet: "Chalet / Ferienhaus", group_house: "Gruppenhaus / Berghütte",
};
/** Ganze Einheit vermieten (eine Wohnung, ein Haus) statt einzelner Zimmer */
export const isWholeUnit = (t: string) => t === "apartment" || t === "chalet" || t === "group_house";
export const unitWord = (t: string) => (t === "apartment" ? "Wohnung" : t === "chalet" ? "Haus" : t === "group_house" ? "Unterkunft" : "Zimmer");

export const CANTONS = ["AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH"] as const;

export class OnboardingError extends Error {}

export const registerSchema = z.object({
  propertyType: z.enum(PROPERTY_TYPES),
  name: z.string().trim().min(2, "Name des Betriebs fehlt").max(120),
  contactName: z.string().trim().min(2, "Ihr Name fehlt").max(120),
  email: z.string().trim().toLowerCase().email("E-Mail-Adresse prüfen").max(200),
  canton: z.enum(CANTONS, { message: "Kanton wählen" }),
  municipality: z.string().trim().min(2, "Gemeinde fehlt").max(100),
  acceptTerms: z.literal(true, { message: "Bitte die Bedingungen akzeptieren" }),
});
export type RegisterInput = z.input<typeof registerSchema>;

async function uniqueHotelSlug(name: string): Promise<string> {
  const base = slugify(name).slice(0, 40) || "betrieb";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [x] = await db().select({ id: hotels.id }).from(hotels).where(eq(hotels.slug, slug));
    if (!x) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Neuer Gastgeber: Betrieb (Entwurf), Benutzer (Inhaber), Annahme der Bedingungen, Mindestgebühr,
 * Willkommensmail und Login-Link. Gibt den Login-Link zurück (für die Entwicklung ohne Mailversand).
 */
export async function registerHost(input: RegisterInput, now = new Date()) {
  const v = registerSchema.parse(input);
  const slug = await uniqueHotelSlug(v.name);
  const hotel = await db().transaction(async (tx) => {
    const [h] = await tx.insert(hotels).values({
      slug, name: v.name, canton: v.canton, municipality: v.municipality, contactEmail: v.email, status: "draft",
      propertyType: v.propertyType,
      // ASSUMPTION: Ferienwohnungen, Chalets und Gruppenhäuser fallen unter die Kurtaxe-Kategorie «group» (Parahotellerie); im Assistenten bestätigt der Gastgeber den Satz.
      touristTaxCategory: isWholeUnit(v.propertyType) ? "group" : "hotel",
      // ASSUMPTION: Selbst registrierte Betriebe aller Arten: 1 %, mindestens CHF 19 pro Monat. Bestehende, von Hand angelegte Hotels bleiben ohne Minimum.
      monthlyMinimumRappen: DEFAULT_MONTHLY_MINIMUM_RAPPEN,
      hostTermsVersion: HOST_TERMS_VERSION, hostTermsAcceptedAt: now,
      onboarding: { startedAt: now.toISOString(), reminders: 0 },
      content: { languages: ["de", "en"] },
    }).returning();
    const [u] = await tx.insert(users).values({ email: v.email, name: v.contactName })
      .onConflictDoUpdate({ target: users.email, set: { name: sql`coalesce(${users.name}, ${v.contactName})` } }).returning();
    await tx.insert(hotelMembers).values({ hotelId: h.id, userId: u.id, role: "owner" }).onConflictDoNothing();
    await audit(tx, { hotelId: h.id, actor: `user:${u.id}`, action: "host.register", entity: "hotel", entityId: h.id, details: { propertyType: v.propertyType, terms: HOST_TERMS_VERSION } });
    await enqueueEmail(tx, { hotelId: h.id, template: "host_welcome", to: v.email, language: "de", data: { contactName: v.contactName, propertyType: v.propertyType } });
    return h;
  });
  const loginLink = await requestLoginLink(v.email, now);
  return { hotel, loginLink };
}

// ---------------------------------------------------------------- Schritte

export type StepKey = "betrieb" | "kurtaxe" | "unterkunft" | "fotos" | "ankunft" | "zahlungen" | "karte" | "live";
export type Step = { key: StepKey; title: string; done: boolean; required: boolean };

export async function onboardingSteps(hotel: Hotel): Promise<Step[]> {
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)));
  const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true)));
  const problems = await goLiveProblems(hotel);
  const unit = unitWord(hotel.propertyType);
  const photos = (hotel.content.photos?.length ?? 0) + rts.reduce((n, r) => n + r.photos.length, 0);
  return [
    { key: "betrieb", title: "Angaben zum Betrieb", done: !!(hotel.addressLine && hotel.postalCode && hotel.city), required: true },
    { key: "kurtaxe", title: "Kurtaxe", done: !problems.some((p) => p.startsWith("Kurtaxe")), required: true },
    { key: "unterkunft", title: `${isWholeUnit(hotel.propertyType) ? unit : "Zimmer"} und Preise`, done: rts.length > 0 && rts.every((r) => rps.some((p) => p.roomTypeId === r.id)), required: true },
    { key: "fotos", title: "Fotos", done: photos > 0, required: true },
    { key: "ankunft", title: "Infos zur Ankunft", done: !!hotel.content.arrivalInfo?.de, required: false },
    { key: "zahlungen", title: "Zahlungen empfangen", done: !problems.some((p) => p.startsWith("Stripe")), required: true },
    { key: "karte", title: "Karte für die Grundgebühr", done: hotel.monthlyMinimumRappen === 0 || !!hotel.billingPaymentMethodId, required: hotel.monthlyMinimumRappen > 0 },
    { key: "live", title: "Online gehen", done: hotel.status === "live", required: true },
  ];
}

export function nextOpenStep(steps: Step[]): StepKey {
  return (steps.find((s) => !s.done && s.key !== "live") ?? steps[steps.length - 1]).key;
}

// ---------------------------------------------------------------- Unterkunft mit Preis in einem Schritt

export const CANCEL_TEMPLATES = {
  flexibel: { label: "Flexibel: kostenlos bis 2 Tage vor Anreise, danach 100 %", freeCancelHours: 48, cancelFeeBps: 10000 },
  moderat: { label: "Moderat: kostenlos bis 14 Tage vor Anreise, danach 50 %", freeCancelHours: 14 * 24, cancelFeeBps: 5000 },
  streng: { label: "Streng: kostenlos bis 30 Tage vor Anreise, danach 100 %", freeCancelHours: 30 * 24, cancelFeeBps: 10000 },
  keine: { label: "Nicht stornierbar", freeCancelHours: null, cancelFeeBps: 10000 },
} as const;
export type CancelTemplate = keyof typeof CANCEL_TEMPLATES;

export const unitSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  description: z.string().trim().max(2000).default(""),
  count: z.number().int().min(1).max(200),
  maxPersons: z.number().int().min(1).max(30),
  priceRappen: z.number().int().min(100, "Preis pro Nacht fehlt").max(10_000_000),
  minNights: z.number().int().min(1).max(60).default(1),
  arrivalWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  cancel: z.enum(Object.keys(CANCEL_TEMPLATES) as [CancelTemplate, ...CancelTemplate[]]),
  breakfast: z.boolean().default(false),
  cleaningRappen: z.number().int().min(0).max(1_000_000).default(0),
});
export type UnitInput = z.input<typeof unitSchema>;

/** Zimmertyp/Wohnung + Tarif + (optional) obligatorische Endreinigung – aus den normalen Services zusammengesetzt */
export async function addUnit(hotel: Hotel, input: UnitInput, actor: string) {
  const v = unitSchema.parse(input);
  const n = (await db().select({ id: roomTypes.id }).from(roomTypes).where(eq(roomTypes.hotelId, hotel.id))).length;
  const rt = await createRoomType(hotel.id, {
    name: v.name, description: v.description || null, roomCount: v.count,
    maxAdults: v.maxPersons, maxChildren: Math.max(0, v.maxPersons - 1), maxOccupancy: v.maxPersons, sortOrder: n, active: true,
  }, actor);
  const c = CANCEL_TEMPLATES[v.cancel];
  // Ganze Wohnung: Preis gilt für alle Personen (Grundbelegung = max. Personen, kein Zuschlag/Rabatt)
  const whole = isWholeUnit(hotel.propertyType);
  await createRatePlan(hotel.id, rt.id, {
    name: "Standard", breakfastIncluded: v.breakfast, freeCancelHours: c.freeCancelHours, cancelFeeBps: c.cancelFeeBps,
    baseOccupancy: whole ? v.maxPersons : Math.min(2, v.maxPersons), extraAdultRappen: 0, singleDiscountRappen: 0,
    minNights: v.minNights, arrivalWeekdays: v.arrivalWeekdays, active: true,
  }, v.priceRappen, actor);
  if (v.cleaningRappen > 0) {
    await createExtra(hotel.id, { name: { de: "Endreinigung", en: "Final cleaning", fr: "Nettoyage final", it: "Pulizia finale", nl: "Eindschoonmaak" }, priceRappen: v.cleaningRappen, unit: "per_booking", mandatory: true, roomTypeIds: [rt.id] }, actor);
  }
  return rt;
}

// ---------------------------------------------------------------- Ankunft

export async function setArrivalInfo(hotel: Hotel, text: Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>, actor: string) {
  const clean = Object.fromEntries(Object.entries(text).map(([k, x]) => [k, (x ?? "").trim().slice(0, 2000) || undefined]));
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
    await tx.update(hotels).set({ content: { ...h.content, arrivalInfo: clean }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "hotel.arrival_info", entity: "hotel", entityId: hotel.id });
  });
}

// ---------------------------------------------------------------- Live

/** Alle Pflichtschritte erledigt → Website anlegen, live schalten, Glückwunsch-Mail */
export async function goLiveFromWizard(hotel: Hotel, actor: string, now = new Date()) {
  const steps = await onboardingSteps(hotel);
  const open = steps.filter((s) => s.required && !s.done && s.key !== "live");
  if (open.length) throw new OnboardingError(`Noch offen: ${open.map((s) => s.title).join(", ")}`);
  await ensureHomePage(hotel, actor);
  await setHotelStatus(hotel, "live", actor);
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  await db().update(hotels).set({
    liveSince: h.liveSince ?? now,
    onboarding: { ...h.onboarding, completedAt: h.onboarding.completedAt ?? now.toISOString() },
  }).where(eq(hotels.id, hotel.id));
  if (!h.onboarding.completedAt) {
    await enqueueEmail(db(), { hotelId: hotel.id, template: "host_live", to: hotel.contactEmail, language: "de", data: { slug: hotel.slug } });
  }
}

// ---------------------------------------------------------------- Erinnerungen (Job)

/**
 * Täglich: Wer die Einrichtung begonnen, aber nicht abgeschlossen hat, bekommt nach 2 und 7 Tagen eine Erinnerung.
 * Nach 7 Tagen zusätzlich ein Hinweis an die Plattform (persönlich nachfassen).
 */
export async function onboardingReminders(now = new Date()): Promise<number> {
  const open = rows<{ id: string }>(await db().execute(sql`
    SELECT id FROM hotels WHERE status = 'draft' AND onboarding ? 'startedAt' AND NOT onboarding ? 'completedAt'`));
  let sent = 0;
  for (const { id } of open) {
    const [h] = await db().select().from(hotels).where(eq(hotels.id, id));
    const days = (now.getTime() - Date.parse(h.onboarding.startedAt!)) / 864e5;
    const n = h.onboarding.reminders ?? 0;
    if ((n === 0 && days >= 2) || (n === 1 && days >= 7)) {
      const steps = await onboardingSteps(h);
      const openSteps = steps.filter((s) => s.required && !s.done && s.key !== "live").map((s) => s.title);
      await db().transaction(async (tx) => {
        await enqueueEmail(tx, { hotelId: h.id, template: "host_onboarding_reminder", to: h.contactEmail, language: "de", data: { openSteps, n: n + 1 } });
        const alert = n === 1 && env().PLATFORM_ALERT_EMAIL;
        if (alert) {
          await enqueueEmail(tx, { hotelId: h.id, template: "platform_onboarding_alert", to: env().PLATFORM_ALERT_EMAIL!, language: "de",
            data: { hotel: h.name, email: h.contactEmail, propertyType: h.propertyType, openSteps, days: Math.floor(days) } });
        }
        await tx.update(hotels).set({ onboarding: { ...h.onboarding, reminders: n + 1, ...(alert ? { alertedAt: now.toISOString() } : {}) } }).where(eq(hotels.id, h.id));
      });
      sent++;
    }
  }
  return sent;
}

/** Website-Startseite vorhanden? (für die Vorschau im Assistenten) */
export async function hasHomePage(hotelId: string) {
  return (await db().select({ id: sitePages.id }).from(sitePages).where(and(eq(sitePages.hotelId, hotelId), eq(sitePages.slug, "")))).length > 0;
}


// ---------------------------------------------------------------- Angaben zum Betrieb

export const basicsSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt").max(120),
  addressLine: z.string().trim().min(2, "Strasse fehlt").max(200),
  postalCode: z.string().trim().regex(/^\d{4}$/, "PLZ (4 Ziffern)"),
  city: z.string().trim().min(2, "Ort fehlt").max(100),
  contactPhone: z.string().trim().max(40).default(""),
  checkinTime: z.string().regex(/^\d{2}:\d{2}$/, "Check-in-Zeit"),
  checkoutTime: z.string().regex(/^\d{2}:\d{2}$/, "Check-out-Zeit"),
  intro: z.string().trim().max(1000).default(""),
});

export async function updateBasics(hotel: Hotel, input: z.input<typeof basicsSchema>, actor: string) {
  const v = basicsSchema.parse(input);
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
    await tx.update(hotels).set({
      name: v.name, addressLine: v.addressLine, postalCode: v.postalCode, city: v.city, contactPhone: v.contactPhone || null,
      checkinTime: v.checkinTime, checkoutTime: v.checkoutTime,
      content: { ...h.content, de: { ...(h.content.de ?? {}), headline: h.content.de?.headline ?? v.name, intro: v.intro || h.content.de?.intro } },
      updatedAt: new Date(),
    }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "hotel.basics", entity: "hotel", entityId: hotel.id });
  });
}
