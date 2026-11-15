/** Posteingang (SPEC 19.9): Webhook-Nachricht von Channex lesen. Reine Logik, ohne I/O. */

export type IncomingMessage = {
  event: "message" | "message_thread_booking_assigned";
  propertyId: string;
  threadId: string;
  messageId: string | null;
  sender: "guest" | "hotel";
  text: string;
  attachments: unknown[];
  channexBookingId: string | null;
  provider: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * ASSUMPTION: Feldnamen nach Channex-Doku (Webhook-Ereignisse «message» und «message_thread_booking_assigned»:
 * property_id, booking_id auf oberster Ebene; message_thread_id, id/ota_message_id, message, sender, attachments in payload).
 * Fehlt etwas, wird nichts erfunden: Ohne Betrieb oder Thread-Id → null (ignorieren). Mit Staging prüfen.
 */
export function parseMessageWebhook(body: unknown): IncomingMessage | null {
  const b = rec(body);
  const event = b.event;
  if (event !== "message" && event !== "message_thread_booking_assigned") return null;
  const p = rec(b.payload);
  const propertyId = str(b.property_id) ?? str(p.property_id);
  const threadId = str(p.message_thread_id) ?? str(p.thread_id) ?? str(b.message_thread_id);
  if (!propertyId || !threadId) return null;
  const sender = str(p.sender) === "guest" ? "guest" : "hotel";
  return {
    event,
    propertyId,
    threadId,
    messageId: event === "message" ? (str(p.id) ?? str(p.message_id) ?? str(p.ota_message_id)) : null,
    sender,
    text: str(p.message) ?? "",
    attachments: Array.isArray(p.attachments) ? p.attachments : [],
    channexBookingId: str(b.booking_id) ?? str(p.booking_id),
    provider: str(p.ota) ?? str(p.provider) ?? str(b.ota) ?? "",
  };
}

/** Kurztext für Liste und Mitteilung */
export const preview = (t: string, n = 120) => (t.replace(/\s+/g, " ").trim().slice(0, n));
