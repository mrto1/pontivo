import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, emailOutbox, hotels } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { setModule } from "../../src/services/modules";
import { FeedbackError, feedbackSummary, listFeedback, saveFeedbackSettings, submitFeedback } from "../../src/services/feedback";
import { render } from "../../src/email/templates";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function book(h: Awaited<ReturnType<typeof makeHotel>>) {
  const checkin = inDays(20);
  const { booking } = await createDirectBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest: { ...guest, marketingConsent: true }, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  return (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
}
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];

describe("Bewertungen einholen (SPEC 19.2)", () => {
  it("Einstellungen werden geprüft (nur https, Note 2 bis 5)", async () => {
    const h = await makeHotel();
    await expect(saveFeedbackSettings(h.hotel, { reviewUrl: "http://x.ch", minScore: 4 }, "t")).rejects.toBeInstanceOf(FeedbackError);
    await expect(saveFeedbackSettings(h.hotel, { reviewUrl: "kein link", minScore: 4 }, "t")).rejects.toBeInstanceOf(FeedbackError);
    await expect(saveFeedbackSettings(h.hotel, { reviewUrl: "", minScore: 1 }, "t")).rejects.toBeInstanceOf(FeedbackError);
    await saveFeedbackSettings(h.hotel, { reviewUrl: "https://g.page/r/abc", minScore: 4 }, "t");
    expect((await fresh(h.hotel.id)).content.feedback).toEqual({ reviewUrl: "https://g.page/r/abc", minScore: 4 });
  });

  it("Nachher-Mail: mit Modul der Link zur Frage, ohne Modul wie bisher", async () => {
    const off = await makeHotel();
    const bOff = await book(off);
    const [mOff] = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, bOff.id), eq(emailOutbox.template, "post_stay")));
    expect((mOff.data as { feedback?: boolean }).feedback).toBe(false);

    const on = await makeHotel();
    await setModule(on.hotel.id, "feedback", true, "t");
    const bOn = await book(on);
    const [mOn] = await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, bOn.id), eq(emailOutbox.template, "post_stay")));
    expect((mOn.data as { feedback?: boolean }).feedback).toBe(true);
    const r = render("post_stay", "de", { hotel: await fresh(on.hotel.id), booking: bOn, guestName: "Anna", data: mOn.data as Record<string, unknown>, baseUrl: "https://pontivo.ch" });
    expect(r.text).toContain(`/b/${bOn.publicToken}/feedback`);
    expect(r.text).toContain("Aufenthalt bewerten");
  });

  it("gute Note mit Link → öffentlich, schlechte → intern mit Mail ans Haus, nur einmal", async () => {
    const h = await makeHotel();
    await setModule(h.hotel.id, "feedback", true, "t");
    await saveFeedbackSettings(h.hotel, { reviewUrl: "https://g.page/r/abc", minScore: 4 }, "t");
    const good = await book(h);
    const bad = await book(h);
    expect(await submitFeedback(good.publicToken, 5, "Top!")).toEqual({ outcome: "public", reviewUrl: "https://g.page/r/abc" });
    expect(await submitFeedback(good.publicToken, 1, "doch nicht")).toEqual({ outcome: "already" });
    expect(await submitFeedback(bad.publicToken, 2, "Zimmer war laut")).toEqual({ outcome: "internal" });
    const alerts = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.hotel.id), eq(emailOutbox.template, "feedback_alert")));
    expect(alerts.length).toBe(1);
    expect(alerts[0].toEmail).toBe(h.hotel.contactEmail);
    expect(alerts[0].bookingId).toBe(bad.id);
    expect((await listFeedback(h.hotel.id)).map((x) => x.score).sort()).toEqual([2, 5]);
    expect(await feedbackSummary(h.hotel.id)).toEqual({ n: 2, average: 3.5 });
  });

  it("ohne Link der Bewertungsseite bleibt auch eine gute Note intern; ungültige Note und fremder Token", async () => {
    const h = await makeHotel();
    const b = await book(h);
    await expect(submitFeedback(b.publicToken, 0, "")).rejects.toThrow("invalid_score");
    await expect(submitFeedback(b.publicToken, 6, "")).rejects.toThrow("invalid_score");
    await expect(submitFeedback("gibt-es-nicht", 5, "")).rejects.toThrow("not_found");
    expect(await submitFeedback(b.publicToken, 5, "")).toEqual({ outcome: "internal" });
  });

  it("Mandantentrennung: Rückmeldungen nur im eigenen Haus", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const ba = await book(a);
    await submitFeedback(ba.publicToken, 3, "ok");
    expect((await listFeedback(b.hotel.id)).length).toBe(0);
    expect((await listFeedback(a.hotel.id)).length).toBe(1);
  });
});
