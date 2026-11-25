import { and, eq, sql } from "drizzle-orm";
import { applyModules } from "./modules";
import { startModules } from "../domain/module-choice";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotelMembers, hotelModules, hotels, posItems, posTables, ratePlans, restaurantSettings, roomTypes, sitePages, users, type Hotel } from "../db/schema";
import { slugify } from "../domain/blocks";
import { billingReady } from "../domain/platform-invoice";
import { DEFAULT_MONTHLY_MINIMUM_RAPPEN, HOST_TERMS_VERSION } from "../legal/host-terms";
import { enqueueEmail } from "../email/enqueue";
import { requestLoginLink } from "../auth/session";
import { hashPassword, passwordProblem } from "../auth/password";
import { env } from "../env";
import { isDisposableEmail } from "../domain/disposable-email";
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

export const PROPERTY_TYPES = ["hotel", "bnb", "apartment", "chalet", "group_house", "restaurant"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_LABEL: Record<PropertyType, string> = {
  hotel: "Hotel / Gasthof", bnb: "Bed & Breakfast", apartment: "Ferienwohnung", chalet: "Chalet / Ferienhaus", group_house: "Gruppenhaus / Berghütte", restaurant: "Restaurant / Café / Take-away",
};
/** Reines Restaurant ohne Zimmer (SPEC 20.1) */
export const isRestaurant = (t: string) => t === "restaurant";
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
  /** «website» = Pontivo ist die Website; «booking_only» = eigene Website behalten, nur Buchungssystem */
  mode: z.enum(["website", "booking_only"]).default("website"),
  websiteUrl: z.string().trim().max(300).optional(),
  /** Passwort für die spätere Anmeldung. Mit Passwort bestätigt der Link in der Mail nur die Adresse (meldet nicht an). */
  password: z.string().optional(),
}).superRefine((v, ctx) => {
  const p = v.password ? passwordProblem(v.password) : null;
  if (p) ctx.addIssue({ code: "custom", path: ["password"], message: p });
}).transform((v, ctx) => {
  if (v.mode !== "booking_only") return { ...v, websiteUrl: undefined };
  const raw = v.websiteUrl ?? "";
  const url = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
  if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) {
    ctx.addIssue({ code: "custom", path: ["websiteUrl"], message: "Adresse Ihrer Website angeben, z. B. www.chalet-edelweiss.ch" });
    return z.NEVER;
  }
  return { ...v, websiteUrl: url };
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
/** Die E-Mail-Adresse hat schon ein Konto: kein zweites Konto und kein zweiter Entwurf (weitere Betriebe: angemeldet über /admin/neu) */
export class DisposableEmailError extends Error {
  constructor() { super("Wegwerf-E-Mail-Adresse"); }
}

export class AccountExistsError extends Error {
  constructor(readonly email: string) { super("Für diese E-Mail-Adresse gibt es schon ein Konto."); }
}

export async function registerHost(input: RegisterInput, now = new Date(), opts: { noLogin?: boolean; allowExisting?: boolean } = {}) {
  const v = registerSchema.parse(input);
  if (!opts.allowExisting) {
    const [ex] = await db().select({ id: users.id }).from(users).where(eq(users.email, v.email.trim().toLowerCase()));
    if (ex) throw new AccountExistsError(v.email.trim().toLowerCase());
    if (isDisposableEmail(v.email)) throw new DisposableEmailError();
  }
  const slug = await uniqueHotelSlug(v.name);
  const hotel = await db().transaction(async (tx) => {
    const [h] = await tx.insert(hotels).values({
      slug, name: v.name, canton: v.canton, municipality: v.municipality, contactEmail: v.email, status: "draft",
      propertyType: v.propertyType,
      // ASSUMPTION: Ferienwohnungen, Chalets und Gruppenhäuser fallen unter die Kurtaxe-Kategorie «group» (Parahotellerie); im Assistenten bestätigt der Gastgeber den Satz.
      touristTaxCategory: isWholeUnit(v.propertyType) ? "group" : "hotel",
      // ASSUMPTION: Selbst registrierte Betriebe aller Arten: 1,9 %, mindestens CHF 19 pro Monat. Bestehende, von Hand angelegte Hotels bleiben ohne Minimum.
      monthlyMinimumRappen: DEFAULT_MONTHLY_MINIMUM_RAPPEN,
      hostTermsVersion: HOST_TERMS_VERSION, hostTermsAcceptedAt: now,
      onboarding: { startedAt: now.toISOString(), reminders: 0 },
      content: { languages: ["de", "en"], brand: { mode: v.mode, ...(v.websiteUrl ? { websiteUrl: v.websiteUrl } : {}) } },
    }).returning();
    const passwordHash = v.password ? await hashPassword(v.password) : null;
    const [u] = await tx.insert(users).values({ email: v.email, name: v.contactName, ...(passwordHash ? { passwordHash } : {}) })
      .onConflictDoUpdate({ target: users.email, set: { name: sql`coalesce(${users.name}, ${v.contactName})` } }).returning();
    await tx.insert(hotelMembers).values({ hotelId: h.id, userId: u.id, role: "owner" }).onConflictDoNothing();
    // Startprofil als feste Einträge: Funktionen sind von Anfang an schaltbar (Wizard «Was brauchen Sie?», Funktionen-Seite)
    await tx.insert(hotelModules).values(Object.entries(startModules(isWholeUnit(v.propertyType), isRestaurant(v.propertyType))).map(([module, enabled]) => ({ hotelId: h.id, module, enabled })));
    await audit(tx, { hotelId: h.id, actor: `user:${u.id}`, action: "host.register", entity: "hotel", entityId: h.id, details: { propertyType: v.propertyType, terms: HOST_TERMS_VERSION } });
    return h;
  });
  // Eine einzige Mail: die Willkommensmail enthält den Anmelde-Link (keine zweite «Login-Link»-Mail)
  // Mit Passwort: Aktivierungslink (bestätigt nur die Adresse, Anmeldung danach mit Passwort oder Passkey). Ohne: Anmelde-Link wie bisher.
  const activate = !!v.password;
  const loginLink = opts.noLogin ? null : await requestLoginLink(v.email, now, { mail: false, purpose: activate ? "activate" : "login" });
  await enqueueEmail(db(), { hotelId: hotel.id, template: "host_welcome", to: v.email, language: "de", data: { contactName: v.contactName, propertyType: v.propertyType, mode: v.mode, link: loginLink, activate } });
  return { hotel, loginLink };
}

// ---------------------------------------------------------------- Schritte

/** Wizard-Schritt «Was brauchen Sie?»: Auswahl anwenden (Abhängigkeiten werden aufgelöst) und den Schritt als erledigt vermerken */
export async function chooseModules(hotel: Hotel, wanted: Record<string, boolean>, actor: string) {
  await applyModules(hotel.id, wanted, actor);
  await db().update(hotels).set({ onboarding: { ...hotel.onboarding, modulesChosenAt: new Date().toISOString() } }).where(eq(hotels.id, hotel.id));
}


export type StepKey = "betrieb" | "funktionen" | "umstieg" | "kurtaxe" | "unterkunft" | "fotos" | "ankunft" | "zahlungen" | "karte" | "live" | "einbinden" | "tische" | "speisekarte" | "reservierung";
export type Step = { key: StepKey; title: string; done: boolean; required: boolean };

export async function onboardingSteps(hotel: Hotel): Promise<Step[]> {
  if (isRestaurant(hotel.propertyType)) return restaurantSteps(hotel);
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)));
  const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true)));
  const problems = await goLiveProblems(hotel);
  const unit = unitWord(hotel.propertyType);
  const photos = (hotel.content.photos?.length ?? 0) + rts.reduce((n, r) => n + r.photos.length, 0);
  return [
    { key: "betrieb", title: "Angaben zum Betrieb", done: !!(hotel.addressLine && hotel.postalCode && hotel.city), required: true },
    { key: "funktionen", title: "Was brauchen Sie?", done: !!hotel.onboarding.modulesChosenAt, required: true },
    { key: "umstieg", title: "Bisherige Software", done: !!hotel.onboarding.previousSoftware, required: true },
    { key: "kurtaxe", title: "Kurtaxe", done: !problems.some((p) => p.startsWith("Kurtaxe")), required: true },
    { key: "unterkunft", title: `${isWholeUnit(hotel.propertyType) ? unit : "Zimmer"} und Preise`, done: rts.length > 0 && rts.every((r) => rps.some((p) => p.roomTypeId === r.id)), required: true },
    { key: "fotos", title: "Fotos", done: photos > 0, required: true },
    { key: "ankunft", title: "Infos zur Ankunft", done: !!hotel.content.arrivalInfo?.de, required: false },
    { key: "zahlungen", title: "Zahlungen empfangen", done: !problems.some((p) => p.startsWith("Stripe")), required: true },
    { key: "karte", title: "Grundgebühr: Karte oder QR-Rechnung", done: hotel.monthlyMinimumRappen === 0 || billingReady(hotel), required: hotel.monthlyMinimumRappen > 0 },
    { key: "live", title: "Online gehen", done: hotel.status === "live", required: true },
    // Nur Buchungssystem: Link oder Knopf auf der eigenen Website einbauen
    ...(bookingOnly(hotel) ? [{ key: "einbinden" as const, title: "Auf Website einbauen", done: !!hotel.onboarding.embeddedAt, required: false }] : []),
  ];
}

/**
 * Schritte für reine Restaurants (SPEC 20.1, Selbst-Onboarding Konzept 7a): feste Reihenfolge, Reservation geht vor allem anderen live.
 * Es gibt keinen Schritt «Online gehen»: «Reservation live schalten» stellt Website und Reservierung zugleich online. Stripe blockiert nur Zahlungen.
 */
async function restaurantSteps(hotel: Hotel): Promise<Step[]> {
  const [tables, items, cfg] = await Promise.all([
    db().select({ id: posTables.id }).from(posTables).where(and(eq(posTables.hotelId, hotel.id), eq(posTables.active, true))),
    db().select({ id: posItems.id }).from(posItems).where(and(eq(posItems.hotelId, hotel.id), eq(posItems.active, true))),
    db().select().from(restaurantSettings).where(eq(restaurantSettings.hotelId, hotel.id)),
  ]);
  return [
    { key: "betrieb", title: "Angaben und Öffnungszeiten", done: !!(hotel.addressLine && hotel.postalCode && hotel.city), required: true },
    { key: "tische", title: "Tische und Plätze", done: tables.length > 0, required: true },
    { key: "reservierung", title: "Reservation live schalten", done: !!cfg[0]?.onlineEnabled && hotel.status === "live", required: true },
    { key: "speisekarte", title: "Speisekarte", done: items.length > 0, required: true },
    { key: "zahlungen", title: "Zahlungen (Stripe)", done: stripeReady(hotel), required: false },
    { key: "funktionen", title: "Weitere Funktionen", done: !!hotel.onboarding.modulesChosenAt, required: false },
    { key: "karte", title: "Grundgebühr: Karte oder QR-Rechnung", done: hotel.monthlyMinimumRappen === 0 || billingReady(hotel), required: hotel.monthlyMinimumRappen > 0 },
    ...(bookingOnly(hotel) ? [{ key: "einbinden" as const, title: "Auf Website einbauen", done: !!hotel.onboarding.embeddedAt, required: false }] : []),
  ];
}

/** Kann der Betrieb online Geld annehmen? (Testbetrieb ohne Stripe: ja) */
export const stripeReady = (h: Pick<Hotel, "stripeAccountId" | "stripeChargesEnabled">) => env().PAYMENT_PROVIDER !== "stripe" || !!(h.stripeAccountId && h.stripeChargesEnabled);

/** Restaurant: Reservation und Website online stellen (Konzept 7a Schritt 3), ohne auf Stripe zu warten */
export async function goLiveRestaurant(hotel: Hotel, actor: string, now = new Date()) {
  await ensureHomePage(hotel, actor);
  if (hotel.status !== "live") await setHotelStatus(hotel, "live", actor);
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  await db().update(hotels).set({ liveSince: h.liveSince ?? now }).where(eq(hotels.id, hotel.id));
}

/** Alle Pflichtschritte erledigt → Einrichtung abgeschlossen (Hinweiszeile verschwindet) */
export async function markSetupCompleteIfDone(hotel: Hotel, now = new Date()) {
  if (hotel.onboarding.completedAt) return;
  const steps = await onboardingSteps(hotel);
  if (steps.some((s) => s.required && !s.done)) return;
  await db().update(hotels).set({ onboarding: { ...hotel.onboarding, completedAt: now.toISOString() } }).where(eq(hotels.id, hotel.id));
}

export type CheckItem = { key: string; title: string; done: boolean; href: string; hint?: string; wait?: boolean };

/**
 * Checkliste «Bereit für den Betrieb» im Heute der Gastronomie (Konzept 7a). Jeder offene Schritt mit Link;
 * was Pontivo nicht beschleunigen kann (Stripe-Prüfung, eigene Domain), mit Hinweis und erwarteter Dauer.
 */
export async function diningChecklist(hotel: Hotel): Promise<CheckItem[]> {
  const base = `/admin/${hotel.id}`;
  const resto = isRestaurant(hotel.propertyType);
  const [tables, items, cfg] = await Promise.all([
    db().select({ id: posTables.id }).from(posTables).where(and(eq(posTables.hotelId, hotel.id), eq(posTables.active, true))),
    db().select({ id: posItems.id }).from(posItems).where(and(eq(posItems.hotelId, hotel.id), eq(posItems.active, true))),
    db().select().from(restaurantSettings).where(eq(restaurantSettings.hotelId, hotel.id)),
  ]);
  const online = !!cfg[0]?.onlineEnabled && hotel.status === "live";
  const stripe = stripeReady(hotel);
  const list: CheckItem[] = [];
  if (resto) list.push({ key: "betrieb", title: "Angaben und Öffnungszeiten", done: !!(hotel.addressLine && hotel.city), href: `${base}/einrichten?step=betrieb` });
  list.push({ key: "tische", title: "Tische und Plätze", done: tables.length > 0, href: resto ? `${base}/einrichten?step=tische` : `${base}/restaurant/tische` });
  list.push({ key: "reservierung", title: "Reservation online", done: online, href: resto ? `${base}/einrichten?step=reservierung` : `${base}/restaurant/einstellungen#online`, hint: online ? undefined : "Gäste reservieren über Ihre Website, einen Link oder QR-Code. Geht sofort, ohne Stripe." });
  list.push({ key: "speisekarte", title: "Speisekarte", done: items.length > 0, href: `${base}/restaurant/artikel`, hint: items.length ? undefined : "Per KI aus Website oder PDF, per CSV oder von Hand." });
  list.push({
    key: "zahlungen", title: "Zahlungen (Stripe)", done: stripe, href: resto ? `${base}/einrichten?step=zahlungen` : `${base}/zahlungen`, wait: !stripe && !!hotel.stripeAccountId,
    hint: stripe ? undefined : hotel.stripeAccountId
      ? "In Prüfung bei Stripe, meist 1–2 Werktage. Pontivo kann das nicht beschleunigen. Bis dahin ohne Anzahlung; Reservierungen laufen normal."
      : "Nötig für Anzahlungen und später die Online-Bestellung. Alles andere läuft schon ohne.",
  });
  // Online-Bestellung (SPEC 20.4): freiwillig, schaltet erst nach Speisekarte, Stripe und Probebestellung live
  const { orderSettings, orderReadiness } = await import("./online-orders");
  const ord = await orderSettings(hotel.id);
  const miss = ord.enabled ? [] : await orderReadiness(hotel);
  list.push({
    key: "bestellung", title: "Online-Bestellung (freiwillig)", done: ord.enabled, href: `${base}/restaurant/bestellung-einstellungen`, wait: !ord.enabled && miss.length > 0 && miss.every((m) => m.key === "stripe") && !!hotel.stripeAccountId,
    hint: ord.enabled ? undefined : miss.length ? `Fehlt noch: ${miss.map((m) => m.text).join(" ")}` : "Bereit: jetzt live schalten.",
  });
  if (resto && hotel.monthlyMinimumRappen > 0) list.push({ key: "karte", title: "Grundgebühr: Karte oder QR-Rechnung", done: billingReady(hotel), href: `${base}/einrichten?step=karte` });
  list.push({ key: "domain", title: "Eigene Domain (freiwillig)", done: !!hotel.primaryDomain, href: `${base}/site`, hint: hotel.primaryDomain ? undefined : "Später möglich. Nach der Umstellung beim Domain-Anbieter dauert es bis zu 24 Stunden." });
  return list;
}

export const bookingOnly = (h: Pick<Hotel, "content">) => h.content.brand?.mode === "booking_only" && !!h.content.brand.websiteUrl;

/** Einbau auf der eigenen Website als erledigt markieren (vom Gastgeber bestätigt oder automatisch gefunden) */
export async function markEmbedded(hotel: Hotel, how: "confirmed" | "detected", actor: string) {
  await db().update(hotels).set({ onboarding: { ...hotel.onboarding, embeddedAt: new Date().toISOString() } }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "host.embedded", entity: "hotel", entityId: hotel.id, details: { how } });
}

/**
 * Prüft, ob die eigene Website des Gastgebers auf die Buchung verweist (Link /h/<slug>, Widget data-pontivo="<slug>" oder eigene Domain).
 * Nur die Startseite, höchstens 5 Sekunden, keine Weiterleitungen auf fremde Hosts nötig.
 */
export async function detectEmbed(hotel: Hotel, fetcher: typeof fetch = fetch): Promise<boolean> {
  const url = hotel.content.brand?.websiteUrl;
  if (!url) return false;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(5000), redirect: "follow", headers: { "user-agent": "Pontivo-Einbau-Pruefung" } });
    if (!res.ok) return false;
    const html = (await res.text()).slice(0, 2_000_000);
    const marks = [`data-pontivo="${hotel.slug}"`, `/widget/${hotel.slug}.js`, `/h/${hotel.slug}/`, ...(hotel.primaryDomain ? [hotel.primaryDomain] : [])];
    return marks.some((m) => html.includes(m));
  } catch {
    return false;
  }
}

/** Nächster sinnvoller Schritt: offene Pflichtschritte, dann Live-Gang, danach Einbau (nur Buchungssystem) */
export function nextOpenStep(steps: Step[]): StepKey {
  const req = steps.find((s) => s.required && !s.done && s.key !== "live");
  if (req) return req.key;
  const live = steps.find((s) => s.key === "live");
  // Restaurant (ohne Schritt «Online gehen»): nächster freiwilliger offener Schritt, sonst der erste
  if (!live) return (steps.find((s) => !s.done) ?? steps[0]).key;
  if (!live.done) return "live";
  const embed = steps.find((s) => s.key === "einbinden" && !s.done);
  return embed ? "einbinden" : "live";
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

/** Infos für den Aufenthalt im Gästeportal (SPEC 19.13) */
export async function setGuestInfo(hotel: Hotel, text: Partial<Record<"de" | "en" | "fr" | "it" | "nl", string>>, actor: string) {
  const clean = Object.fromEntries(Object.entries(text).map(([k, x]) => [k, (x ?? "").trim().slice(0, 4000) || undefined]));
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotel.id)).for("update");
    await tx.update(hotels).set({ content: { ...h.content, guestInfo: clean }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "hotel.guest_info", entity: "hotel", entityId: hotel.id });
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

/** Restaurant im Assistenten: N Tische mit gleich vielen Plätzen anlegen («Tisch 1» …), bestehende Namen werden übersprungen */
export async function quickTables(hotel: Hotel, count: number, seats: number, actor: string): Promise<number> {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new OnboardingError("Anzahl Tische: 1 bis 100.");
  if (!Number.isInteger(seats) || seats < 1 || seats > 50) throw new OnboardingError("Plätze je Tisch: 1 bis 50.");
  const have = new Set((await db().select({ name: posTables.name }).from(posTables).where(eq(posTables.hotelId, hotel.id))).map((t) => t.name));
  const n0 = have.size;
  const values = Array.from({ length: count }, (_, i) => `Tisch ${i + 1}`).filter((name) => !have.has(name)).map((name, i) => ({ hotelId: hotel.id, name, seats, sortOrder: n0 + i }));
  if (values.length) await db().insert(posTables).values(values).onConflictDoNothing();
  await audit(db(), { hotelId: hotel.id, actor, action: "pos.tables_quick", entity: "hotel", entityId: hotel.id, details: { count: values.length, seats } });
  return values.length;
}

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

/** Weiterer Betrieb für einen angemeldeten Gastgeber: gleiches Konto (E-Mail), neuer Entwurf, Inhaber-Rolle, kein neuer Login-Link */
export async function addHotelForUser(user: { email: string; name: string | null }, input: Omit<RegisterInput, "email" | "contactName">, now = new Date()) {
  return registerHost({ ...input, email: user.email, contactName: user.name?.trim() || user.email }, now, { noLogin: true, allowExisting: true });
}
