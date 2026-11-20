import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, emailOutbox, guests } from "../../src/db/schema";
import { saveDirectSettings, winbackJob } from "../../src/services/direct-tools";
import { unsubscribe, unsubscribeToken } from "../../src/services/newsletter";
import { render } from "../../src/email/templates";
import { addDays, todayIn } from "../../src/domain/dates";
import { uid, makeHotel } from "../helpers";

afterAll(closeDb);

const mails = (hotelId: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotelId), eq(emailOutbox.template, "winback")));
const today = () => todayIn("Europe/Zurich");

async function stay(hotelId: string, o: { consent?: boolean; daysAgo?: number; source?: string; email?: string; language?: string } = {}) {
  const email = o.email ?? `gast-${uid()}@example.ch`;
  const [g] = await db().insert(guests).values({ hotelId, firstName: "Anna", lastName: "Muster", email, language: o.language ?? "de", marketingConsent: o.consent ?? true }).returning();
  const checkout = addDays(today(), -(o.daysAgo ?? 330));
  const [b] = await db().insert(bookings).values({ hotelId, reference: `T-${uid()}`, publicToken: uid() + uid(), source: o.source ?? "direct", status: "confirmed", guestId: g.id,
    checkin: addDays(checkout, -2), checkout, adults: 2, totalRappen: 36000, roomsTotalRappen: 36000, confirmedAt: new Date() }).returning();
  return { g, b, email };
}

describe("Wiederkehr-Mail", () => {
  it("einmalig, mit Datum ein Jahr später und Abmeldelink; nur mit Einwilligung, nur direkt, nur wenn eingeschaltet", async () => {
    const { hotel } = await makeHotel({});
    const ok = await stay(hotel.id);
    const noConsent = await stay(hotel.id, { consent: false });
    const ota = await stay(hotel.id, { source: "booking_com" });
    const early = await stay(hotel.id, { daysAgo: 100 });
    // ausgeschaltet (Standard): nichts
    await winbackJob();
    expect(await mails(hotel.id)).toHaveLength(0);

    await saveDirectSettings(hotel.id, { winback: { enabled: true, afterDays: 330 } }, "t");
    await winbackJob();
    const m = await mails(hotel.id);
    expect(m.map((x) => x.toEmail)).toEqual([ok.email]);
    const data = m[0].data as { url: string; unsubscribeUrl: string; stayMonth: string };
    expect(data.url).toContain(`checkin=${addDays(ok.b.checkin, 364)}&checkout=${addDays(ok.b.checkout, 364)}`);
    expect(data.unsubscribeUrl).toContain("/abmelden?h=");
    const out = render("winback", "de", { hotel, data, baseUrl: "https://x", booking: ok.b } as never);
    expect(out.text).toContain("Keine Einladungen mehr erhalten");
    expect(out.subject).toContain(hotel.name);
    // zweiter Lauf am selben Tag: keine zweite Mail
    await winbackJob();
    expect(await mails(hotel.id)).toHaveLength(1);
    void noConsent; void ota; void early;
  });

  it("nicht, wenn der Gast schon wieder gebucht hat; höchstens eine Mail je Adresse; Abmelden widerruft die Einwilligung", async () => {
    const { hotel } = await makeHotel({});
    await saveDirectSettings(hotel.id, { winback: { enabled: true } }, "t");
    const email = `treu-${uid()}@example.ch`;
    const first = await stay(hotel.id, { email });
    await stay(hotel.id, { email, daysAgo: -20 }); // kommende Buchung (Abreise in 20 Tagen)
    const second = await stay(hotel.id, { email: `zwei-${uid()}@example.ch` });
    await winbackJob();
    expect((await mails(hotel.id)).map((m) => m.toEmail)).toEqual([second.email]);
    void first;
    // Abmelden: Einwilligung weg
    const token = unsubscribeToken(hotel.id, second.email);
    expect(await unsubscribe(hotel.id, second.email, token)).toBe(true);
    expect((await db().select().from(guests).where(eq(guests.id, second.g.id)))[0].marketingConsent).toBe(false);
  });

  it("Mail in der Sprache des Gastes", async () => {
    const { hotel } = await makeHotel({});
    await saveDirectSettings(hotel.id, { winback: { enabled: true } }, "t");
    await stay(hotel.id, { language: "fr" });
    await winbackJob();
    const [m] = await mails(hotel.id);
    expect(m.language).toBe("fr");
    expect(render("winback", "fr", { hotel, data: m.data as Record<string, unknown>, baseUrl: "https://x" }).subject).toContain("De nouveau chez");
  });
});
