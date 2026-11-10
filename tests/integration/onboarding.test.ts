import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { auditLog, bookings, emailOutbox, hotelMembers, hotels, platformCharges, users } from "../../src/db/schema";
import { addUnit, detectEmbed, goLiveFromWizard, markEmbedded, nextOpenStep, onboardingReminders, onboardingSteps, OnboardingError, registerHost, setArrivalInfo, updateBasics } from "../../src/services/onboarding";
import { confirmTouristTax } from "../../src/services/settings";
import { searchOffers } from "../../src/services/search";
import { finishCardSetup, processCharges, runMonthlyMinimum, startCardSetup } from "../../src/services/billing";
import { shiftMonth } from "../../src/services/overview";
import { setPaymentProvider, type PaymentProvider } from "../../src/payments/provider";
import { FakePaymentProvider } from "../../src/payments/fake";
import { render } from "../../src/email/templates";
import { addDays, todayIn, weekday } from "../../src/domain/dates";
import { uid } from "../helpers";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const mails = async (hotelId: string, template: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotelId), eq(emailOutbox.template, template)));
const register = (o: Record<string, unknown> = {}) => registerHost({
  propertyType: "apartment", name: `Chalet ${uid()}`, contactName: "Ruth Keller", email: `host-${uid()}@example.ch`,
  canton: "GR", municipality: `Testdorf-${uid()}`, acceptTerms: true, ...o,
} as never);

/** Nächster Samstag ab in 10 Tagen */
function nextSaturday(): string {
  let d = addDays(todayIn("Europe/Zurich"), 10);
  while (weekday(d) !== 6) d = addDays(d, 1);
  return d;
}

describe("Selbst-Registrierung und Einrichtung", () => {
  it("Registrierung legt Entwurf mit Inhaber, Bedingungen, Mindestgebühr an und schickt Willkommens- und Login-Mail", async () => {
    await expect(register({ acceptTerms: false })).rejects.toThrow();
    await expect(register({ canton: "XX" })).rejects.toThrow();
    const { hotel, loginLink } = await register();
    expect(hotel).toMatchObject({ status: "draft", propertyType: "apartment", monthlyMinimumRappen: 1900, touristTaxCategory: "group" });
    expect(hotel.hostTermsVersion).toBeTruthy();
    expect(loginLink).toContain("/api/auth/callback?token=");
    const [m] = await db().select().from(hotelMembers).innerJoin(users, eq(users.id, hotelMembers.userId)).where(eq(hotelMembers.hotelId, hotel.id));
    expect(m.hotel_members.role).toBe("owner");
    expect(m.users.email).toBe(hotel.contactEmail);
    expect(await mails(hotel.id, "host_welcome")).toHaveLength(1);
    // gleicher Name → eigener Slug
    const again = await register({ name: hotel.name });
    expect(again.hotel.slug).not.toBe(hotel.slug);
  });

  it("Assistent: Schritte bis live; fester Anreisetag; Endreinigung im Preis; Karte vor dem Live-Gang", async () => {
    const { hotel } = await register();
    let steps = await onboardingSteps(hotel);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(["zahlungen"]); // Fake-Zahlung

    await updateBasics(hotel, { name: hotel.name, addressLine: "Dorfstrasse 5", postalCode: "7270", city: "Davos", checkinTime: "16:00", checkoutTime: "10:00", intro: "Ruhig gelegen." }, "t");
    await confirmTouristTax(await fresh(hotel.id), { adultRappen: 350, reducedRappen: null, freeUnderAge: 12, reducedUnderAge: null }, "t");
    await addUnit(await fresh(hotel.id), { name: "Wohnung Bergsicht", count: 1, maxPersons: 4, priceRappen: 18000, minNights: 3, arrivalWeekdays: [6], cancel: "moderat", cleaningRappen: 9000 }, "t");
    await setArrivalInfo(await fresh(hotel.id), { de: "Schlüsselbox Code 4711" }, "t");
    steps = await onboardingSteps(await fresh(hotel.id));
    expect(steps.filter((s) => !s.done).map((s) => s.key)).toEqual(["fotos", "karte", "live"]);
    await expect(goLiveFromWizard(await fresh(hotel.id), "t")).rejects.toThrow(OnboardingError);

    // Suche: nur Samstag, Endreinigung im Total, ganze Wohnung = gleicher Preis für 1–4 Personen
    const sat = nextSaturday();
    const h = await fresh(hotel.id);
    const bad = await searchOffers(h, { checkin: addDays(sat, 1), checkout: addDays(sat, 8), adults: 2, children: 0 });
    expect(bad.ok && bad.offers.length).toBe(0);
    expect(bad.ok && bad.rejected[0].reason).toBe("closed_to_arrival");
    const two = await searchOffers(h, { checkin: sat, checkout: addDays(sat, 7), adults: 2, children: 0 });
    const four = await searchOffers(h, { checkin: sat, checkout: addDays(sat, 7), adults: 4, children: 0 });
    if (!two.ok || !four.ok) throw new Error("search");
    expect(two.offers[0].roomsTotalRappen).toBe(7 * 18000);
    expect(four.offers[0].roomsTotalRappen).toBe(7 * 18000);
    expect(two.offers[0].extrasRappen).toBe(9000);
    expect(two.offers[0].totalRappen).toBe(7 * 18000 + 9000 + 2 * 350 * 7);
    // Mindestaufenthalt 3 Nächte
    const short = await searchOffers(h, { checkin: sat, checkout: addDays(sat, 2), adults: 2, children: 0 });
    expect(short.ok && short.offers.length).toBe(0);

    // Foto und Karte (Fake: Setup-Session sofort abgeschlossen)
    await db().update(hotels).set({ content: { ...h.content, photos: [{ url: `/media/${h.id}/abcdefghijklmnop.jpg` }] } }).where(eq(hotels.id, h.id));
    const url = await startCardSetup(await fresh(h.id), `/admin/${h.id}/einrichten?step=karte`);
    const sessionId = new URL(url).searchParams.get("session_id")!;
    await expect(finishCardSetup(await fresh(h.id), "fake_setup_other", "t")).rejects.toThrow();
    expect((await finishCardSetup(await fresh(h.id), sessionId, "t")).label).toContain("4242");

    await goLiveFromWizard(await fresh(h.id), "t");
    const live = await fresh(h.id);
    expect(live.status).toBe("live");
    expect(live.liveSince).toBeTruthy();
    expect(live.onboarding.completedAt).toBeTruthy();
    expect(await mails(h.id, "host_live")).toHaveLength(1);
    expect((await onboardingSteps(live)).every((s) => s.done)).toBe(true);

    // Ankunftsinfos gehen mit der Mail vor der Anreise mit
    const pre = render("pre_arrival", "de", { hotel: live, data: {}, baseUrl: "https://x" });
    expect(pre.text).toContain("Schlüsselbox Code 4711");
  });

  it("Erinnerungen nach 2 und 7 Tagen, beim zweiten Mal Hinweis an die Plattform", async () => {
    const { hotel } = await register();
    const t0 = new Date(Date.parse(hotel.onboarding.startedAt!));
    const before = (await onboardingReminders(new Date(t0.getTime() + 1 * 864e5)));
    expect((await mails(hotel.id, "host_onboarding_reminder"))).toHaveLength(0);
    void before;
    await onboardingReminders(new Date(t0.getTime() + 2.1 * 864e5));
    await onboardingReminders(new Date(t0.getTime() + 3 * 864e5)); // nichts Neues
    expect(await mails(hotel.id, "host_onboarding_reminder")).toHaveLength(1);
    expect(await mails(hotel.id, "platform_onboarding_alert")).toHaveLength(0);
    await onboardingReminders(new Date(t0.getTime() + 7.1 * 864e5));
    expect(await mails(hotel.id, "host_onboarding_reminder")).toHaveLength(2);
    const [alert] = await mails(hotel.id, "platform_onboarding_alert");
    expect(alert.toEmail).toBe("alarm@example.ch");
    await onboardingReminders(new Date(t0.getTime() + 30 * 864e5));
    expect(await mails(hotel.id, "host_onboarding_reminder")).toHaveLength(2);
  });
});

describe("Nur Buchungssystem (eigene Website behalten)", () => {
  it("Registrierung mit eigener Website, Schritt «Einbauen» nach dem Live-Gang, Prüfung der Website", async () => {
    await expect(register({ mode: "booking_only" })).rejects.toThrow(/Adresse Ihrer Website/);
    await expect(register({ mode: "booking_only", websiteUrl: "keine adresse" })).rejects.toThrow();
    const { hotel } = await register({ mode: "booking_only", websiteUrl: "www.chalet-edelweiss.ch" });
    expect(hotel.content.brand).toEqual({ mode: "booking_only", websiteUrl: "https://www.chalet-edelweiss.ch" });
    const plain = (await register({ mode: "website", websiteUrl: "www.egal.ch" })).hotel;
    expect(plain.content.brand).toEqual({ mode: "website" });
    expect((await onboardingSteps(plain)).some((s) => s.key === "einbinden")).toBe(false);

    let steps = await onboardingSteps(hotel);
    expect(steps.map((s) => s.key).slice(-2)).toEqual(["live", "einbinden"]);
    // vor dem Live-Gang führt der Assistent nicht zum Einbau
    expect(nextOpenStep(steps.map((s) => (s.required && s.key !== "live" ? { ...s, done: true } : s)))).toBe("live");
    await db().update(hotels).set({ status: "live" }).where(eq(hotels.id, hotel.id));
    steps = await onboardingSteps(await fresh(hotel.id));
    expect(nextOpenStep(steps.map((s) => (s.required ? { ...s, done: true } : s)))).toBe("einbinden");

    const page = (html: string, status = 200) => (async () => new Response(html, { status })) as unknown as typeof fetch;
    const h = await fresh(hotel.id);
    expect(await detectEmbed(h, page("<html><a href='/kontakt'>Kontakt</a></html>"))).toBe(false);
    expect(await detectEmbed(h, page(`<a href="https://pontivo.ch/h/${h.slug}/de">Buchen</a>`))).toBe(true);
    expect(await detectEmbed(h, page(`<div data-pontivo="${h.slug}" data-mode="button"></div>`))).toBe(true);
    expect(await detectEmbed(h, page("", 500))).toBe(false);
    expect(await detectEmbed(h, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(false);
    await markEmbedded(h, "detected", "t");
    expect((await onboardingSteps(await fresh(h.id))).find((s) => s.key === "einbinden")!.done).toBe(true);

    // Live-Mail mit Hinweis zum Einbau
    const live = render("host_live", "de", { hotel: await fresh(h.id), data: {}, baseUrl: "https://x" });
    expect(live.text).toContain("Link oder Knopf");
    expect(live.text).toContain("step=einbinden");
  });
});

describe("Mindestgebühr", () => {
  async function liveHost(liveMonthsAgo: number, card = true) {
    const { hotel } = await register();
    const liveSince = new Date(Date.now() - liveMonthsAgo * 31 * 864e5);
    await db().update(hotels).set({
      status: "live", liveSince,
      ...(card ? { billingCustomerId: `fake_cus_${hotel.id}`, billingPaymentMethodId: `fake_pm_${hotel.id}`, billingCardLabel: "Testkarte •••• 4242" } : {}),
    }).where(eq(hotels.id, hotel.id));
    return fresh(hotel.id);
  }
  const lastMonth = () => shiftMonth(todayIn("Europe/Zurich").slice(0, 7), -1);
  const chargeOf = async (hotelId: string) => (await db().select().from(platformCharges).where(eq(platformCharges.hotelId, hotelId)))[0];

  it("Differenz zum Minimum wird belastet, nur einmal pro Monat; mit 1 % darüber nichts", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    const a = await liveHost(3);
    const b = await liveHost(3);
    // b: Direktbuchung im Vormonat mit CHF 25 Gebühr → über dem Minimum
    const [y, m] = lastMonth().split("-").map(Number);
    const conf = new Date(Date.UTC(y, m - 1, 15, 10));
    await db().insert(bookings).values({ hotelId: b.id, reference: `T-${uid()}`, publicToken: uid() + uid(), source: "direct", status: "confirmed",
      checkin: "2026-01-10", checkout: "2026-01-12", adults: 2, totalRappen: 250000, roomsTotalRappen: 250000, platformFeeRappen: 2500, confirmedAt: conf });
    // c: Gebühr CHF 5 → Differenz 14
    const c = await liveHost(3);
    await db().insert(bookings).values({ hotelId: c.id, reference: `T-${uid()}`, publicToken: uid() + uid(), source: "direct", status: "confirmed",
      checkin: "2026-01-10", checkout: "2026-01-12", adults: 2, totalRappen: 50000, roomsTotalRappen: 50000, platformFeeRappen: 500, confirmedAt: conf });

    await runMonthlyMinimum();
    expect(await chargeOf(a.id)).toMatchObject({ month: lastMonth(), feesRappen: 0, chargeRappen: 1900, status: "succeeded", attempts: 1 });
    expect(await chargeOf(b.id)).toMatchObject({ feesRappen: 2500, chargeRappen: 0, status: "none" });
    expect(await chargeOf(c.id)).toMatchObject({ feesRappen: 500, chargeRappen: 1400, status: "succeeded" });
    expect(fake.charges.find((x) => x.hotel.id === c.id)!.amountRappen).toBe(1400);
    expect(await mails(a.id, "host_minimum_charged")).toHaveLength(1);

    const n = fake.charges.length;
    await runMonthlyMinimum();
    expect(fake.charges.length).toBe(n);
    const logs = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, a.id), eq(auditLog.action, "billing.minimum_charged")));
    expect(logs).toHaveLength(1);
  });

  it("Erster Monat nach dem Live-Gang ist frei; Entwürfe zahlen nichts", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const { hotel } = await register();
    await db().update(hotels).set({ status: "live", liveSince: new Date() }).where(eq(hotels.id, hotel.id));
    const draft = (await register()).hotel;
    await runMonthlyMinimum();
    expect(await chargeOf(hotel.id)).toBeUndefined();
    expect(await chargeOf(draft.id)).toBeUndefined();
  });

  it("Fehlgeschlagene Belastung: Mail, nach 3 Tagen erneut, nach 3 Versuchen Hinweis an die Plattform; neue Karte → sofort neu", async () => {
    let ok = false;
    const flaky: PaymentProvider = Object.assign(new FakePaymentProvider(), {
      async chargeSavedCard(a: { idempotencyKey: string }) {
        return ok ? { ok: true as const, paymentIntentId: `pi_${a.idempotencyKey}` } : { ok: false as const, paymentIntentId: null, error: "card_declined" };
      },
    });
    setPaymentProvider(flaky);
    const h = await liveHost(2);
    const noCard = await liveHost(2, false);
    const now = new Date();
    await runMonthlyMinimum(now);
    expect(await chargeOf(h.id)).toMatchObject({ status: "failed", attempts: 1, error: "card_declined" });
    expect(await chargeOf(noCard.id)).toMatchObject({ status: "failed", error: "no_card" });
    expect(await mails(h.id, "host_charge_failed")).toHaveLength(1);

    // neue Karte: Fehlversuch wird sofort wieder fällig
    ok = true;
    await finishCardSetup(noCard, `fake_setup_${noCard.id}`, "t");
    await processCharges(new Date(now.getTime() + 60_000));
    expect(await chargeOf(noCard.id)).toMatchObject({ status: "succeeded", attempts: 2 });
    ok = false;

    await processCharges(new Date(now.getTime() + 864e5)); // zu früh
    expect((await chargeOf(h.id)).attempts).toBe(1);
    await processCharges(new Date(now.getTime() + 3.1 * 864e5));
    await processCharges(new Date(now.getTime() + 6.2 * 864e5));
    expect(await chargeOf(h.id)).toMatchObject({ status: "failed", attempts: 3 });
    expect((await mails(h.id, "platform_onboarding_alert")).length).toBe(1);
    await processCharges(new Date(now.getTime() + 20 * 864e5));
    expect((await chargeOf(h.id)).attempts).toBe(3);

  });
});
