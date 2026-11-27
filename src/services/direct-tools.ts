import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db, rows, type Executor } from "../db/client";
import { bookingRooms, bookings, companies, companyCodes, guests, hotels, inventoryDays, roomTypes, waitlistEntries, type Company, type CompanyCode, type Hotel, type WaitlistEntry } from "../db/schema";
import {
  MAX_CODE_DISCOUNT_BPS, RECOVERY_AFTER_MIN, RECOVERY_WITHIN_HOURS, cleanBenefits, codeUsable, findGaps, gapSettings, normalizeCode, recoveryEnabled, waitlistEnabled, winbackSettings,
  type DirectSettings, type Gap,
} from "../domain/direct-tools";
import { MAX_NIGHTS } from "../domain/availability";
import { addDays, diffDays, isDay, todayIn } from "../domain/dates";
import { newPublicToken } from "../domain/ids";
import { env } from "../env";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";
import { moduleOn } from "./modules";
import { publicBase } from "./brand";
import { unsubscribeUrl } from "./newsletter";
import { isBookable } from "./hotels";
import { searchOffers } from "./search";
import type { Locale } from "../i18n/dict";
import { isLocale } from "../i18n/dict";

/**
 * Direktbuchungs-Werkzeuge (SPEC 19.29): Einstellungen, Firmencodes, Warteliste, Lückenübersicht, Abbruch-Mail.
 * Jede Abfrage nach hotel_id.
 */
export class DirectError extends Error {}

// ---------------------------------------------------------------- Einstellungen

/** Einzelne Bereiche der Direktbuchungs-Einstellungen speichern (nur die übergebenen Bereiche ändern sich) */
export async function saveDirectSettings(hotelId: string, patch: DirectSettings, actor: string): Promise<DirectSettings> {
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotelId));
  if (!h) throw new DirectError("Betrieb nicht gefunden.");
  const cur = h.content.direct ?? {};
  const next: DirectSettings = { ...cur };
  if (patch.benefits) {
    const items = cleanBenefits(patch.benefits.items ?? []);
    next.benefits = { enabled: patch.benefits.enabled === true && items.length > 0, items };
  }
  if (patch.gaps) {
    const g = gapSettings({ gaps: patch.gaps });
    next.gaps = { enabled: patch.gaps.enabled === true, maxNights: g.maxNights, discountBps: g.discountBps, relaxMinStay: g.relaxMinStay };
  }
  if (patch.recovery) next.recovery = { enabled: patch.recovery.enabled === true };
  if (patch.waitlist) next.waitlist = { enabled: patch.waitlist.enabled !== false };
  if (patch.winback) { const w = winbackSettings({ winback: patch.winback }); next.winback = { enabled: patch.winback.enabled === true, afterDays: w.afterDays }; }
  await db().update(hotels).set({ content: { ...h.content, direct: next }, updatedAt: new Date() }).where(eq(hotels.id, hotelId));
  await audit(db(), { hotelId, actor, action: "hotel.direct_settings", entity: "hotel", entityId: hotelId, details: patch as Record<string, unknown> });
  return next;
}

// ---------------------------------------------------------------- Firmencodes

export type CodeInput = { companyId: string; code?: string; discountPct: number; payOnInvoice: boolean; validFrom?: string | null; validUntil?: string | null; active?: boolean };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Zufälliger, gut lesbarer Code (ohne 0/O/1/I) */
export function randomCode(len = 8): string {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

export type CodeRow = CompanyCode & { companyName: string; used: number };

export async function listCodes(hotelId: string): Promise<CodeRow[]> {
  const r = await db()
    .select({ c: companyCodes, companyName: companies.name })
    .from(companyCodes)
    .innerJoin(companies, eq(companies.id, companyCodes.companyId))
    .where(eq(companyCodes.hotelId, hotelId))
    .orderBy(asc(companies.name), asc(companyCodes.code));
  const used = rows<{ id: string; n: number }>(await db().execute(sql`SELECT company_code_id AS id, count(*)::int AS n FROM bookings WHERE hotel_id = ${hotelId} AND company_code_id IS NOT NULL AND status IN ('confirmed','hold') GROUP BY 1`));
  const by = new Map(used.map((u) => [u.id, u.n]));
  return r.map((x) => ({ ...x.c, companyName: x.companyName, used: by.get(x.c.id) ?? 0 }));
}

export async function saveCode(hotelId: string, id: string | null, input: CodeInput, actor: string): Promise<CompanyCode> {
  const code = normalizeCode(input.code || randomCode());
  if (!code) throw new DirectError("Der Code darf nur Grossbuchstaben, Ziffern und Bindestrich enthalten (4 bis 24 Zeichen).");
  const pct = Number(input.discountPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > MAX_CODE_DISCOUNT_BPS / 100) throw new DirectError(`Rabatt: 0 bis ${MAX_CODE_DISCOUNT_BPS / 100} %.`);
  const from = input.validFrom || null, until = input.validUntil || null;
  if ((from && !isDay(from)) || (until && !isDay(until))) throw new DirectError("Ungültiges Datum.");
  if (from && until && until < from) throw new DirectError("«Gültig bis» liegt vor «Gültig ab».");
  const [co] = await db().select().from(companies).where(and(eq(companies.id, input.companyId), eq(companies.hotelId, hotelId)));
  if (!co) throw new DirectError("Firma nicht gefunden.");
  if (input.payOnInvoice && !(await moduleOn(hotelId, "debtors"))) throw new DirectError("«Auf Rechnung» braucht das Modul Debitoren.");
  const v = { companyId: co.id, code, discountBps: Math.round(pct * 100), payOnInvoice: input.payOnInvoice, validFrom: from, validUntil: until, active: input.active ?? true };
  try {
    const [r] = id
      ? await db().update(companyCodes).set(v).where(and(eq(companyCodes.id, id), eq(companyCodes.hotelId, hotelId))).returning()
      : await db().insert(companyCodes).values({ hotelId, ...v }).returning();
    if (!r) throw new DirectError("Code nicht gefunden.");
    await audit(db(), { hotelId, actor, action: id ? "company_code.update" : "company_code.create", entity: "company_code", entityId: r.id, details: { code, company: co.name, discountBps: v.discountBps, payOnInvoice: v.payOnInvoice } });
    return r;
  } catch (e) {
    if (String((e as { code?: string }).code) === "23505") throw new DirectError("Diesen Code gibt es in Ihrem Betrieb schon.");
    throw e;
  }
}

export async function deleteCode(hotelId: string, id: string, actor: string): Promise<void> {
  const gone = await db().delete(companyCodes).where(and(eq(companyCodes.id, id), eq(companyCodes.hotelId, hotelId))).returning();
  if (!gone.length) throw new DirectError("Code nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "company_code.delete", entity: "company_code", entityId: id, details: { code: gone[0].code } });
}

export type ResolvedCode = { code: CompanyCode; company: Company; /** «auf Rechnung» gilt nur, wenn das Modul Debitoren an ist */ payOnInvoice: boolean };

/** Code eines Gastes prüfen: Format, gehört zu diesem Betrieb, aktiv, Anreise im Zeitraum, Firma aktiv. null = ungültig. */
export async function resolveCode(hotel: Pick<Hotel, "id">, raw: string | null | undefined, checkin: string, ex: Executor = db()): Promise<ResolvedCode | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  const [r] = await ex
    .select({ c: companyCodes, co: companies })
    .from(companyCodes)
    .innerJoin(companies, eq(companies.id, companyCodes.companyId))
    .where(and(eq(companyCodes.hotelId, hotel.id), eq(companyCodes.code, code), eq(companies.hotelId, hotel.id)));
  if (!r || !r.co.active || !codeUsable(r.c, checkin)) return null;
  return { code: r.c, company: r.co, payOnInvoice: r.c.payOnInvoice && (await moduleOn(hotel.id, "debtors")) };
}

// ---------------------------------------------------------------- Lücken (Übersicht für das Hotel)

export type GapRow = Gap & { roomTypeId: string; roomTypeName: string };

/** Aktuelle Lücken der nächsten 180 Tage je Zimmertyp (nur zur Anzeige, die Suche rechnet selbst) */
export async function listGaps(hotel: Hotel, now = new Date()): Promise<GapRow[]> {
  const today = todayIn(hotel.timezone, now);
  const end = addDays(today, 180);
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  if (!rts.length) return [];
  const inv = await db().select().from(inventoryDays).where(and(eq(inventoryDays.hotelId, hotel.id), inArray(inventoryDays.roomTypeId, rts.map((r) => r.id)), gte(inventoryDays.night, addDays(today, -1)), lte(inventoryDays.night, end)));
  const max = gapSettings(hotel.content.direct).maxNights;
  const out: GapRow[] = [];
  for (const rt of rts) {
    const nights = inv.filter((i) => i.roomTypeId === rt.id).map((i) => ({ night: i.night, free: i.total - i.booked - i.blocked - i.externalBlocked }));
    for (const g of findGaps(nights, today, max)) out.push({ ...g, roomTypeId: rt.id, roomTypeName: rt.name });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

// ---------------------------------------------------------------- Warteliste

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_WAITING_PER_EMAIL = 5;

export type WaitlistInput = { email: string; name?: string; language?: string; checkin: string; checkout: string; adults: number; children?: number; childAges?: number[] };

/** Gast trägt sich ein. Gleiche Daten und E-Mail zählen einmal; wieder eintragen setzt auf «wartet». */
export async function joinWaitlist(hotel: Hotel, input: WaitlistInput, now = new Date()): Promise<WaitlistEntry> {
  if (!waitlistEnabled(hotel.content.direct)) throw new DirectError("waitlist_off");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new DirectError("invalid_email");
  if (!isDay(input.checkin) || !isDay(input.checkout)) throw new DirectError("invalid_dates");
  const today = todayIn(hotel.timezone, now);
  const n = diffDays(input.checkin, input.checkout);
  if (input.checkin < today || n < 1 || n > MAX_NIGHTS) throw new DirectError("invalid_dates");
  const adults = Math.min(10, Math.max(1, Math.round(input.adults || 1)));
  const children = Math.min(10, Math.max(0, Math.round(input.children ?? 0)));
  const ages = (input.childAges ?? []).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, children);
  const language = isLocale(input.language ?? "") ? (input.language as Locale) : "de";
  const open = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM waitlist_entries WHERE hotel_id = ${hotel.id} AND email = ${email} AND status = 'waiting' AND NOT (checkin = ${input.checkin}::date AND checkout = ${input.checkout}::date)`))[0].n;
  if (open >= MAX_WAITING_PER_EMAIL) throw new DirectError("too_many");
  const [r] = await db()
    .insert(waitlistEntries)
    .values({ hotelId: hotel.id, email, name: String(input.name ?? "").trim().slice(0, 100), language, checkin: input.checkin, checkout: input.checkout, adults, children, childAges: ages, token: newPublicToken() })
    .onConflictDoUpdate({ target: [waitlistEntries.hotelId, waitlistEntries.email, waitlistEntries.checkin, waitlistEntries.checkout], set: { status: "waiting", notifiedAt: null, adults, children, childAges: ages, language } })
    .returning();
  await audit(db(), { hotelId: hotel.id, actor: "guest", action: "waitlist.join", entity: "waitlist", entityId: r.id, details: { checkin: input.checkin, checkout: input.checkout } });
  return r;
}

/** Abmelden über den Link in der Mail (ohne Anmeldung); gibt den Betrieb zurück oder null */
export async function cancelWaitlistByToken(token: string): Promise<{ hotelId: string; language: string } | null> {
  const [r] = await db().update(waitlistEntries).set({ status: "cancelled" }).where(and(eq(waitlistEntries.token, token), ne(waitlistEntries.status, "cancelled"))).returning();
  if (!r) return (await db().select({ hotelId: waitlistEntries.hotelId, language: waitlistEntries.language }).from(waitlistEntries).where(eq(waitlistEntries.token, token)))[0] ?? null;
  await audit(db(), { hotelId: r.hotelId, actor: "guest", action: "waitlist.cancel", entity: "waitlist", entityId: r.id });
  return { hotelId: r.hotelId, language: r.language };
}

export async function listWaitlist(hotelId: string): Promise<WaitlistEntry[]> {
  return db().select().from(waitlistEntries).where(eq(waitlistEntries.hotelId, hotelId)).orderBy(desc(waitlistEntries.createdAt)).limit(300);
}

export async function cancelWaitlistEntry(hotelId: string, id: string, actor: string): Promise<void> {
  const r = await db().update(waitlistEntries).set({ status: "cancelled" }).where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.hotelId, hotelId))).returning();
  if (r.length) await audit(db(), { hotelId, actor, action: "waitlist.cancel_admin", entity: "waitlist", entityId: id });
}

const bookUrl = (hotel: Hotel, lang: string, q: { checkin: string; checkout: string; adults: number; children: number; rooms?: number; ages?: number[] }) =>
  `${publicBase(hotel)}/${lang}/book?checkin=${q.checkin}&checkout=${q.checkout}&adults=${q.adults}&children=${q.children}&rooms=${q.rooms ?? 1}${q.ages?.length ? `&ages=${q.ages.join(",")}` : ""}`;

/**
 * Job (alle 5 Minuten): Wartende Einträge prüfen. Gibt es für die Daten jetzt ein Angebot, geht einmalig eine Mail raus
 * (der Eintrag wird zuerst beansprucht, damit nie zwei Mails entstehen). Eintrag nach der Anreise: abgelaufen.
 */
export async function waitlistJob(now = new Date()): Promise<{ notified: number; expired: number }> {
  const waiting = await db().select().from(waitlistEntries).where(eq(waitlistEntries.status, "waiting")).orderBy(asc(waitlistEntries.createdAt)).limit(500);
  const hotelCache = new Map<string, Hotel | null>();
  let notified = 0, expired = 0;
  for (const w of waiting) {
    let hotel = hotelCache.get(w.hotelId);
    if (hotel === undefined) {
      hotel = (await db().select().from(hotels).where(eq(hotels.id, w.hotelId)))[0] ?? null;
      hotelCache.set(w.hotelId, hotel);
    }
    if (!hotel) continue;
    if (w.checkin < todayIn(hotel.timezone, now)) {
      await db().update(waitlistEntries).set({ status: "expired" }).where(and(eq(waitlistEntries.id, w.id), eq(waitlistEntries.status, "waiting")));
      expired++;
      continue;
    }
    if (!waitlistEnabled(hotel.content.direct) || !isBookable(hotel, env().PAYMENT_PROVIDER)) continue;
    const res = await searchOffers(hotel, { checkin: w.checkin, checkout: w.checkout, adults: w.adults, children: w.children, childrenAges: w.childAges.length === w.children ? w.childAges : undefined }, { now });
    if (!res.ok || res.offers.length === 0) continue;
    const claimed = await db().update(waitlistEntries).set({ status: "notified", notifiedAt: now }).where(and(eq(waitlistEntries.id, w.id), eq(waitlistEntries.status, "waiting"))).returning();
    if (!claimed.length) continue;
    await enqueueEmail(db(), {
      hotelId: hotel.id, template: "waitlist_available", to: w.email, language: w.language,
      data: { name: w.name, checkin: w.checkin, checkout: w.checkout, url: bookUrl(hotel, w.language, { checkin: w.checkin, checkout: w.checkout, adults: w.adults, children: w.children, ages: w.childAges }), cancelUrl: `${env().APP_BASE_URL}/api/waitlist/${w.token}` },
    });
    await audit(db(), { hotelId: hotel.id, actor: "system", action: "waitlist.notify", entity: "waitlist", entityId: w.id });
    notified++;
  }
  return { notified, expired };
}

// ---------------------------------------------------------------- Abbruch-Mail

/**
 * Job (alle 10 Minuten): Reservationen, die abgelaufen sind, ohne dass bezahlt wurde, bekommen einmalig eine Erinnerung,
 * wenn das Hotel sie eingeschaltet hat. Nicht gesendet wird, wenn die Anreise vorbei ist, der Gast inzwischen für diese Zeit gebucht hat,
 * dieselbe Adresse in den letzten 7 Tagen schon eine solche Mail bekam oder für die Daten nichts mehr frei ist.
 */
export async function recoveryJob(now = new Date()): Promise<{ sent: number }> {
  const from = new Date(now.getTime() - RECOVERY_WITHIN_HOURS * 3_600_000);
  const to = new Date(now.getTime() - RECOVERY_AFTER_MIN * 60_000);
  const cands = await db()
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "expired"), eq(bookings.source, "direct"), isNull(bookings.recoverySentAt), gte(bookings.updatedAt, from), lt(bookings.updatedAt, to)))
    .orderBy(asc(bookings.updatedAt))
    .limit(200);
  let sent = 0;
  for (const b of cands) {
    const [hotel] = await db().select().from(hotels).where(eq(hotels.id, b.hotelId));
    if (!hotel || !recoveryEnabled(hotel.content.direct) || !isBookable(hotel, env().PAYMENT_PROVIDER)) continue;
    const [g] = b.guestId ? await db().select().from(guests).where(eq(guests.id, b.guestId)) : [];
    if (!g?.email) continue;
    const skip = async () => { await db().update(bookings).set({ recoverySentAt: now }).where(and(eq(bookings.id, b.id), isNull(bookings.recoverySentAt))); };
    if (b.checkin < todayIn(hotel.timezone, now)) { await skip(); continue; }
    const email = g.email.toLowerCase();
    // inzwischen gebucht (gleiche Adresse, überschneidende Zeit)?
    const dup = rows<{ n: number }>(await db().execute(sql`
      SELECT count(*)::int AS n FROM bookings o JOIN guests og ON og.id = o.guest_id
       WHERE o.hotel_id = ${b.hotelId} AND o.id <> ${b.id} AND lower(og.email) = ${email} AND o.status IN ('confirmed','hold')
         AND o.checkin < ${b.checkout}::date AND o.checkout > ${b.checkin}::date`))[0].n;
    if (dup > 0) { await skip(); continue; }
    const recent = rows<{ n: number }>(await db().execute(sql`
      SELECT count(*)::int AS n FROM email_outbox WHERE hotel_id = ${b.hotelId} AND template = 'booking_recovery' AND lower(to_email) = ${email} AND send_after > ${new Date(now.getTime() - 7 * 864e5).toISOString()}::timestamptz`))[0].n;
    if (recent > 0) { await skip(); continue; }
    const rooms = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
    const res = await searchOffers(hotel, { checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, childrenAges: b.childrenAges.length === b.children ? b.childrenAges : undefined, rooms: Math.max(1, rooms.length) }, { now });
    if (!res.ok || res.offers.length === 0) { await skip(); continue; }
    const claimed = await db().update(bookings).set({ recoverySentAt: now }).where(and(eq(bookings.id, b.id), isNull(bookings.recoverySentAt))).returning({ id: bookings.id });
    if (!claimed.length) continue;
    await enqueueEmail(db(), {
      hotelId: hotel.id, bookingId: b.id, template: "booking_recovery", to: g.email, language: b.language,
      data: { url: bookUrl(hotel, b.language, { checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, rooms: Math.max(1, rooms.length), ages: b.childrenAges }) },
    });
    await audit(db(), { hotelId: hotel.id, actor: "system", action: "booking.recovery_mail", entity: "booking", entityId: b.id });
    sent++;
  }
  return { sent };
}


// ---------------------------------------------------------------- Wiederkehr-Mail

/**
 * Job (täglich): Gäste, die vor N Tagen (Standard 330) abgereist sind, bekommen einmalig eine Einladung mit ihren Daten ein Jahr später.
 * Nur direkt gebuchte Aufenthalte, nur mit Werbe-Einwilligung (die beim Abmelden widerrufen wird), nur wenn der Betrieb es eingeschaltet hat,
 * nicht bei bestehender Buchung ab heute und höchstens eine Mail je Adresse und Betrieb in 300 Tagen. Abmelde-Link in jeder Mail.
 */
export async function winbackJob(now = new Date()): Promise<{ sent: number }> {
  const list = await db().select().from(hotels).where(eq(hotels.status, "live"));
  let sent = 0;
  for (const hotel of list) {
    const w = winbackSettings(hotel.content.direct);
    if (!w.enabled || !isBookable(hotel, env().PAYMENT_PROVIDER)) continue;
    const today = todayIn(hotel.timezone, now);
    const departed = addDays(today, -w.afterDays);
    const stays = await db().select().from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.status, "confirmed"), eq(bookings.source, "direct"), eq(bookings.checkout, departed)));
    for (const b of stays) {
      if (!b.guestId) continue;
      const [g] = await db().select().from(guests).where(eq(guests.id, b.guestId));
      if (!g?.email || !g.marketingConsent) continue;
      const email = g.email.toLowerCase();
      const [{ n }] = rows<{ n: number }>(await db().execute(sql`
        SELECT count(*)::int AS n FROM bookings o JOIN guests og ON og.id = o.guest_id
         WHERE o.hotel_id = ${hotel.id} AND lower(og.email) = ${email} AND o.status IN ('confirmed','hold') AND o.checkout >= ${today}::date`));
      if (n > 0) continue;
      const [{ r }] = rows<{ r: number }>(await db().execute(sql`
        SELECT count(*)::int AS r FROM email_outbox WHERE hotel_id = ${hotel.id} AND template = 'winback' AND lower(to_email) = ${email}
           AND send_after > ${new Date(now.getTime() - 300 * 864e5).toISOString()}::timestamptz`));
      if (r > 0) continue;
      // Wunschdaten: gleicher Zeitraum ein Jahr später (364 Tage = gleicher Wochentag), nur wenn sie mindestens eine Woche entfernt liegen
      const checkin = addDays(b.checkin, 364), checkout = addDays(b.checkout, 364);
      const dates = checkin >= addDays(today, 7);
      const lang = isLocale(g.language) ? g.language : "de";
      await enqueueEmail(db(), { hotelId: hotel.id, bookingId: b.id, template: "winback", to: g.email, language: lang, data: {
        stayMonth: b.checkin.slice(0, 7), unsubscribeUrl: unsubscribeUrl(hotel.id, g.email),
        url: dates ? bookUrl(hotel, lang, { checkin, checkout, adults: b.adults, children: b.children, ages: b.childrenAges }) : `${publicBase(hotel)}/${lang}/book`,
      } });
      await audit(db(), { hotelId: hotel.id, actor: "system", action: "booking.winback_mail", entity: "booking", entityId: b.id });
      sent++;
    }
  }
  return { sent };
}
