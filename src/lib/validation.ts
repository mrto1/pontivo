import { z } from "zod";
import { isDay } from "../domain/dates";

export const dayString = z.string().refine(isDay, "Datum im Format YYYY-MM-DD");
export const locale = z.enum(["de", "en", "fr", "it", "nl"]);

export const createBookingSchema = z
  .object({
    hotel: z.string().max(100).optional(), // Slug, nur für Vorschau /h/<slug>
    room_type_id: z.string().uuid(),
    rate_plan_id: z.string().uuid(),
    checkin: dayString,
    checkout: dayString,
    adults: z.number().int().min(1).max(10),
    children: z.number().int().min(0).max(10).default(0),
    children_ages: z.array(z.number().int().min(0).max(17)).max(10).default([]),
    guest: z.object({
      first_name: z.string().trim().min(1).max(100),
      last_name: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(200),
      phone: z.string().trim().max(40).optional().nullable(),
      language: locale.default("de"),
      notes: z.string().trim().max(1000).optional().nullable(),
      marketing_consent: z.boolean().default(false),
    }),
    terms_accepted: z.literal(true),
    voucher_code: z.string().trim().max(40).optional().nullable(),
  })
  .refine((v) => v.children_ages.length === 0 || v.children_ages.length === v.children, {
    message: "children_ages muss pro Kind ein Alter enthalten",
    path: ["children_ages"],
  });

export type CreateBookingBody = z.infer<typeof createBookingSchema>;

export const searchParamsSchema = z.object({
  checkin: dayString,
  checkout: dayString,
  adults: z.coerce.number().int().min(1).max(10).default(2),
  children: z.coerce.number().int().min(0).max(10).default(0),
  ages: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean).map((x) => Number(x)) : []))
    .pipe(z.array(z.number().int().min(0).max(17))),
});
