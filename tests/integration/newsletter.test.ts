import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, guestProfiles, guests } from "../../src/db/schema";
import { NewsletterError, consentedGuests, saveDraft, sendNewsletter, sendTest, unsubscribe, unsubscribeToken } from "../../src/services/newsletter";
import { makeHotel } from "../helpers";

afterAll(closeDb);
const g = (hotelId: string, email: string, consent: boolean, language = "de") => db().insert(guests).values({ hotelId, firstName: "A", lastName: "B", email, language, marketingConsent: consent });

describe("Newsletter Service (SPEC 19.12)", () => {
  it("nur Einwilligung, einmal je Adresse, Auswahl, Versand einmalig, Mandantentrennung", async () => {
    const h = await makeHotel(), other = await makeHotel();
    await g(h.hotel.id, "ja@example.ch", true);
    await g(h.hotel.id, "JA@example.ch", true); // gleiche Adresse
    await g(h.hotel.id, "nein@example.ch", false);
    await g(h.hotel.id, "en@example.ch", true, "en");
    await g(other.hotel.id, "fremd@example.ch", true);
    await db().insert(guestProfiles).values({ hotelId: h.hotel.id, email: "en@example.ch", tags: ["Stammgast"], updatedBy: "t" });
    expect((await consentedGuests(h.hotel.id)).map((x) => x.email).sort()).toEqual(["en@example.ch", "ja@example.ch"]);
    const d = await saveDraft(h.hotel.id, null, { subject: "Herbst", body: "Hallo\n\nAngebot", segment: { tag: "stammgast" } }, "t");
    expect(await sendNewsletter(h.hotel, d.id, "t")).toBe(1);
    const mails = (await db().select().from(emailOutbox).where(eq(emailOutbox.hotelId, h.hotel.id))).filter((m) => m.template === "newsletter");
    expect(mails.map((m) => m.toEmail)).toEqual(["en@example.ch"]);
    expect(String(mails[0].data.unsubscribeUrl)).toContain("/abmelden?");
    await expect(sendNewsletter(h.hotel, d.id, "t")).rejects.toBeInstanceOf(NewsletterError);
    await expect(sendNewsletter(other.hotel, d.id, "t")).rejects.toBeInstanceOf(NewsletterError);
    const none = await saveDraft(h.hotel.id, null, { subject: "X", body: "Y", segment: { tag: "gibtesnicht" } }, "t");
    await expect(sendNewsletter(h.hotel, none.id, "t")).rejects.toBeInstanceOf(NewsletterError);
    await expect(saveDraft(h.hotel.id, null, { subject: "", body: "Y", segment: {} }, "t")).rejects.toBeInstanceOf(NewsletterError);
    await sendTest(h.hotel, none.id, "test@example.ch", "t");
  });

  it("Abmeldung nur mit gültigem Link, gilt für alle Einträge der Adresse", async () => {
    const h = await makeHotel(), other = await makeHotel();
    await g(h.hotel.id, "weg@example.ch", true);
    await g(h.hotel.id, "WEG@example.ch", true);
    await g(other.hotel.id, "weg@example.ch", true);
    expect(await unsubscribe(h.hotel.id, "weg@example.ch", "falsch")).toBe(false);
    expect(await unsubscribe(h.hotel.id, "weg@example.ch", unsubscribeToken(other.hotel.id, "weg@example.ch"))).toBe(false); // Token eines anderen Betriebs
    expect(await consentedGuests(h.hotel.id)).toHaveLength(1);
    expect(await unsubscribe(h.hotel.id, "Weg@example.ch", unsubscribeToken(h.hotel.id, "weg@example.ch"))).toBe(true);
    expect(await consentedGuests(h.hotel.id)).toHaveLength(0);
    expect(await consentedGuests(other.hotel.id)).toHaveLength(1);
    void and;
  });
});
