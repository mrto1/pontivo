import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { saveMailTexts } from "../../src/services/mail-texts";
import { cleanMailText, fillPlaceholders } from "../../src/domain/mail-texts";
import { render } from "../../src/email/templates";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Mail-Texte (SPEC 17.5)", () => {
  it("bereinigen und Platzhalter", () => {
    expect(cleanMailText({ subject: "  Hallo \n  Welt ", intro: "x".repeat(900), outro: "  " })).toEqual({ subject: "Hallo Welt", intro: "x".repeat(600) });
    expect(fillPlaceholders("Hallo {name}, {hotel} {reference} {foo}", { name: "Anna", hotel: "Seehotel", reference: "BK-1" })).toBe("Hallo Anna, Seehotel BK-1 {foo}");
  });

  it("eigene Texte erscheinen in der Mail, Standardinhalt bleibt; nur die gewählte Sprache; HTML wird maskiert", async () => {
    const h = await makeHotel();
    const checkin = inDays(20);
    const { booking } = await createDirectBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    const b = (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
    const ctx = (hotel: typeof h.hotel) => ({ hotel, booking: b, guestName: "Anna Muster", data: {}, baseUrl: "https://x" });
    const plain = render("booking_confirmed", "de", ctx(h.hotel));

    await saveMailTexts(h.hotel, "booking_confirmed", { de: { subject: "Willkommen bei {hotel}", intro: "Schön, dass Sie kommen, {name}!", outro: "Wir freuen uns <b>sehr</b>." }, en: {} }, "t");
    const hotel = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
    const custom = render("booking_confirmed", "de", ctx(hotel));
    expect(custom.subject).toBe(`Willkommen bei ${hotel.name}`);
    expect(custom.text).toContain("Schön, dass Sie kommen, Anna Muster!");
    expect(custom.text).toContain(b.reference); // Standardinhalt bleibt
    expect(custom.text.indexOf("Schön")).toBeLessThan(custom.text.indexOf("Wir freuen uns"));
    expect(custom.html).toContain("&lt;b&gt;sehr&lt;/b&gt;");
    expect(custom.html).not.toContain("<b>sehr</b>");
    expect(custom.text.startsWith(plain.text.split("\n")[0])).toBe(true); // Anrede bleibt vorn
    // andere Sprache und andere Mail unverändert
    expect(render("booking_confirmed", "en", ctx(hotel)).subject).toBe(render("booking_confirmed", "en", ctx(h.hotel)).subject);
    expect(render("pre_arrival", "de", ctx(hotel)).text).toBe(render("pre_arrival", "de", ctx(h.hotel)).text);
    // leeren stellt den Standard her
    await saveMailTexts(hotel, "booking_confirmed", { de: { subject: "", intro: "", outro: "" } }, "t");
    const back = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
    expect(back.content.mailTexts?.booking_confirmed).toBeUndefined();
    expect(render("booking_confirmed", "de", ctx(back)).text).toBe(plain.text);
    await expect(saveMailTexts(back, "hotel_new_booking", { de: { intro: "x" } }, "t")).rejects.toThrow();
  });
});
