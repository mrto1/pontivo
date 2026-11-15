import { describe, expect, it } from "vitest";
import { parseMessageWebhook } from "../../src/domain/inbox";

describe("Nachrichten-Webhook lesen (SPEC 19.9)", () => {
  const base = { event: "message", property_id: "p1", booking_id: "b1", payload: { message_thread_id: "t1", id: "m1", message: " Hallo ", sender: "guest", ota: "BookingCom" } };
  it("liest Gastnachricht", () => {
    expect(parseMessageWebhook(base)).toMatchObject({ propertyId: "p1", threadId: "t1", messageId: "m1", sender: "guest", text: "Hallo", channexBookingId: "b1", provider: "BookingCom" });
  });
  it("anderer Absender = Hotel", () => {
    expect(parseMessageWebhook({ ...base, payload: { ...base.payload, sender: "property" } })?.sender).toBe("hotel");
  });
  it("Zuordnung ohne Nachricht", () => {
    const m = parseMessageWebhook({ ...base, event: "message_thread_booking_assigned" });
    expect(m?.messageId).toBeNull();
  });
  it("ignoriert fremde Ereignisse und unvollständige Daten", () => {
    expect(parseMessageWebhook({ ...base, event: "booking" })).toBeNull();
    expect(parseMessageWebhook({ ...base, property_id: undefined })).toBeNull();
    expect(parseMessageWebhook({ event: "message", property_id: "p1", payload: {} })).toBeNull();
    expect(parseMessageWebhook(null)).toBeNull();
  });
});
