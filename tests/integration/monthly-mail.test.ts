import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, emailOutbox, hotels } from "../../src/db/schema";
import { monthlyMailJob, monthStats, setMonthlyMail } from "../../src/services/monthly-mail";
import { shiftMonth } from "../../src/services/overview";
import { registerHost } from "../../src/services/onboarding";
import { render } from "../../src/email/templates";
import { todayIn } from "../../src/domain/dates";
import { uid } from "../helpers";

afterAll(closeDb);

const lastMonth = () => shiftMonth(todayIn("Europe/Zurich").slice(0, 7), -1);
const mails = (hotelId: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotelId), eq(emailOutbox.template, "host_monthly")));
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];

async function liveHost() {
  const { hotel } = await registerHost({ propertyType: "hotel", name: `Hotel ${uid()}`, contactName: "Ruth Keller", email: `host-${uid()}@example.ch`, canton: "GR", municipality: `Testdorf-${uid()}`, acceptTerms: true } as never);
  await db().update(hotels).set({ status: "live", liveSince: new Date(Date.now() - 100 * 864e5) }).where(eq(hotels.id, hotel.id));
  return fresh(hotel.id);
}
async function booking(hotelId: string, o: { total: number; tax?: number; fee: number; status?: string; source?: string }) {
  const [y, m] = lastMonth().split("-").map(Number);
  await db().insert(bookings).values({ hotelId, reference: `T-${uid()}`, publicToken: uid() + uid(), source: o.source ?? "direct", status: o.status ?? "confirmed",
    checkin: "2026-01-10", checkout: "2026-01-12", adults: 2, totalRappen: o.total, roomsTotalRappen: o.total - (o.tax ?? 0), touristTaxRappen: o.tax ?? 0, platformFeeRappen: o.fee, confirmedAt: new Date(Date.UTC(y, m - 1, 15, 10)) });
}

describe("Monatsmail an die Inhaber", () => {
  it("Auswertung zählt nur bestätigte Direktbuchungen, ohne Kurtaxe", async () => {
    const h = await liveHost();
    await booking(h.id, { total: 50000, tax: 1000, fee: 950 });
    await booking(h.id, { total: 30000, fee: 570 });
    await booking(h.id, { total: 99999, fee: 1, source: "booking_com" });
    await booking(h.id, { total: 20000, fee: 380, status: "cancelled" });
    // wie die Monatsabrechnung: Umsatz und Gebühr nach Rückerstattung (die stornierte Buchung hier ohne Rückerstattung bleibt Umsatz), gezählt werden bestätigte Buchungen
    expect(await monthStats(h.id, lastMonth())).toMatchObject({ bookings: 2, nights: 4, revenueRappen: 50000 - 1000 + 30000 + 20000, feeRappen: 950 + 570 + 380 });
  });

  it("Job: eine Mail je Inhaber und Monat, Inhalt stimmt, zweiter Lauf sendet nichts mehr", async () => {
    const h = await liveHost();
    await booking(h.id, { total: 50000, tax: 1000, fee: 950 });
    const r = await monthlyMailJob();
    expect(r.mails).toBeGreaterThanOrEqual(1);
    const m = await mails(h.id);
    expect(m).toHaveLength(1);
    expect(m[0].toEmail).toBe(h.contactEmail);
    const out = render("host_monthly", "de", { hotel: h, data: m[0].data as Record<string, unknown>, baseUrl: "https://x" });
    expect(out.text).toContain("Direktbuchungen: 1");
    expect(out.text).toContain("CHF 490.00");
    expect(out.text).toContain(`/report?month=${lastMonth()}`);
    await monthlyMailJob();
    expect(await mails(h.id)).toHaveLength(1);
  });

  it("nicht bei ausgeschalteter Monatsmail, ohne Buchungen oder wenn der Betrieb nicht online ist", async () => {
    const off = await liveHost();
    await booking(off.id, { total: 50000, fee: 950 });
    await setMonthlyMail(off, false, "t");
    const none = await liveHost();
    const draft = await liveHost();
    await booking(draft.id, { total: 50000, fee: 950 });
    await db().update(hotels).set({ status: "draft" }).where(eq(hotels.id, draft.id));
    await monthlyMailJob();
    expect(await mails(off.id)).toHaveLength(0);
    expect(await mails(none.id)).toHaveLength(0);
    expect(await mails(draft.id)).toHaveLength(0);
    // wieder einschalten: kommt beim nächsten Lauf
    await setMonthlyMail(await fresh(off.id), true, "t");
    await monthlyMailJob();
    expect(await mails(off.id)).toHaveLength(1);
  });
});
