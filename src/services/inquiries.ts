import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { inquiries, type Hotel } from "../db/schema";
import { INQUIRY_KINDS, TIME_RE } from "../domain/blocks";
import { isLocale } from "../i18n/dict";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";

/** Anfragen (Tischreservation, Gruppen, Seminare, Hochzeiten …) aus dem Website-Baustein «Anfrageformular» */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null);
export const inquirySchema = z.object({
  kind: z.enum(INQUIRY_KINDS),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).nullable().default(null),
  dateFrom: day,
  dateTo: day,
  persons: z.number().int().min(1).max(2000).nullable().default(null),
  timeOfDay: z.string().regex(TIME_RE).nullable().default(null),
  message: z.string().trim().max(4000).default(""),
  language: z.string().refine(isLocale).default("de"),
  pageSlug: z.string().max(60).default(""),
}).refine((v) => !v.dateFrom || !v.dateTo || v.dateTo >= v.dateFrom, { message: "Enddatum vor Startdatum", path: ["dateTo"] })
  // Tischreservation: Datum, Uhrzeit und Personen nötig
  .refine((v) => v.kind !== "table" || (v.dateFrom && v.timeOfDay && v.persons), { message: "Datum, Uhrzeit und Personen angeben", path: ["timeOfDay"] });

export async function createInquiry(hotel: Hotel, input: z.input<typeof inquirySchema>) {
  const v = inquirySchema.parse(input);
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(inquiries).values({ hotelId: hotel.id, ...v }).returning();
    const data = { inquiryId: row.id, kind: v.kind, name: v.name, email: v.email, phone: v.phone, dateFrom: v.dateFrom, dateTo: v.dateTo, persons: v.persons, timeOfDay: v.timeOfDay, message: v.message };
    await enqueueEmail(tx, { hotelId: hotel.id, template: "inquiry_received", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
    await enqueueEmail(tx, { hotelId: hotel.id, template: "inquiry_confirmation", to: v.email, language: v.language, data });
    await audit(tx, { hotelId: hotel.id, actor: "guest", action: "inquiry.create", entity: "inquiry", entityId: row.id, details: { kind: v.kind } });
    return row;
  });
}

export async function listInquiries(hotelId: string) {
  return db().select().from(inquiries).where(eq(inquiries.hotelId, hotelId)).orderBy(desc(inquiries.createdAt)).limit(300);
}

export async function setInquiryStatus(hotelId: string, id: string, status: "new" | "done", actor: string) {
  const r = await db().update(inquiries).set({ status }).where(and(eq(inquiries.id, id), eq(inquiries.hotelId, hotelId))).returning();
  if (r.length) await audit(db(), { hotelId, actor, action: `inquiry.${status}`, entity: "inquiry", entityId: id });
  return r.length > 0;
}

export async function newInquiryCount(hotelId: string): Promise<number> {
  const r = await db().select({ id: inquiries.id }).from(inquiries).where(and(eq(inquiries.hotelId, hotelId), eq(inquiries.status, "new")));
  return r.length;
}

