import crypto from "node:crypto";
import { z } from "zod";
import { db } from "../db/client";
import { emailSuppressions, inboundEvents } from "../db/schema";

/** Felder gemäss Postmark-Doku (Bounce webhook, Spam complaint webhook); nur die benötigten. */
const eventSchema = z.object({
  RecordType: z.string(),
  ID: z.union([z.number(), z.string()]),
  Type: z.string().optional(),
  Email: z.string().min(3),
  Description: z.string().optional(),
  Details: z.string().optional(),
  Inactive: z.boolean().optional(),
});

/** Prüft Basic Auth (Passwort) oder den Header x-webhook-token gegen das Geheimnis. Postmark signiert nicht. */
export function postmarkAuthorized(headers: Headers, secret: string): boolean {
  const eq = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const token = headers.get("x-webhook-token");
  if (token && eq(token, secret)) return true;
  const basic = headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
    const pw = decoded.slice(decoded.indexOf(":") + 1);
    if (eq(pw, secret)) return true;
  }
  return false;
}

/**
 * Verarbeitet ein Postmark-Ereignis. Gesperrt wird bei Spam-Beschwerde und bei Bounces, die Postmark
 * als `Inactive` meldet (harte Bounces). Vorübergehende Fehler (Transient, Soft bounce) sperren nicht.
 * Idempotent über inbound_events (source "postmark").
 */
export async function handlePostmarkEvent(payload: unknown): Promise<"suppressed" | "ignored" | "duplicate"> {
  const ev = eventSchema.parse(payload);
  if (ev.RecordType !== "Bounce" && ev.RecordType !== "SpamComplaint") return "ignored";
  const inserted = await db()
    .insert(inboundEvents)
    .values({ source: "postmark", eventId: `${ev.RecordType}-${ev.ID}`, type: ev.RecordType, payload: payload as object })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.eventId });
  if (!inserted.length) return "duplicate";
  const spam = ev.RecordType === "SpamComplaint";
  if (!spam && !ev.Inactive) return "ignored";
  await db()
    .insert(emailSuppressions)
    .values({
      email: ev.Email.trim().toLowerCase(),
      reason: spam ? "spam_complaint" : "bounce",
      bounceType: ev.Type ?? null,
      details: ev.Details ?? ev.Description ?? null,
      postmarkId: String(ev.ID),
    })
    .onConflictDoNothing();
  return "suppressed";
}
