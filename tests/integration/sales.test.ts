import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, hotels, salesLeadEvents, salesLeads } from "../../src/db/schema";
import { cockpit, createLead, leadEvents, listLeads, sendLeadMail, SalesError, setLeadStatus, syncLeads, updateLead } from "../../src/services/sales";
import { registerHost } from "../../src/services/onboarding";
import { render } from "../../src/email/templates";
import { uid } from "../helpers";

afterAll(closeDb);

const mails = (to: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.template, "sales_lead"), eq(emailOutbox.toEmail, to)));

describe("Vertriebs-Cockpit", () => {
  it("Lead anlegen, prüfen, Status wechseln (Verlauf), abgeschlossene Leads verlieren den nächsten Schritt", async () => {
    await expect(createLead({ name: "  " }, "t")).rejects.toThrow(SalesError);
    await expect(createLead({ name: "X", email: "kaputt" }, "t")).rejects.toThrow(/E-Mail/);
    await expect(createLead({ name: "X", nextActionAt: "morgen" }, "t")).rejects.toThrow(/Datum/);
    const l = await createLead({ name: `Hotel ${uid()}`, contactName: "Ruth", email: `Ruth-${uid()}@Example.ch`, canton: "gr", source: "messe", nextActionAt: "2026-12-01" }, "t");
    expect(l).toMatchObject({ status: "neu", source: "messe", canton: "GR", nextActionAt: "2026-12-01" });
    expect(l.email).toBe(l.email.toLowerCase());
    await expect(setLeadStatus(l.id, "quatsch", "t")).rejects.toThrow(/Status/);
    const d = await setLeadStatus(l.id, "demo", "t");
    expect(d.status).toBe("demo");
    const won = await setLeadStatus(l.id, "gewonnen", "t");
    expect(won.nextActionAt).toBeNull();
    expect((await leadEvents(l.id)).map((e) => e.text)).toEqual(expect.arrayContaining(["neu → demo", "demo → gewonnen"]));
  });

  it("Mail aus Vorlage: Platzhalter gefüllt, Status neu → kontaktiert, Verlauf, gesperrt ohne Adresse oder bei «nicht kontaktieren»", async () => {
    const email = `ruth-${uid()}@example.ch`;
    const l = await createLead({ name: "Chalet Sonne", contactName: "Ruth Keller", email }, "t");
    await sendLeadMail(l.id, "erstkontakt", { extraLine: "Wir haben uns auf der Messe gesehen.", senderName: "Martin" }, "t");
    const [m] = await mails(email);
    expect(m.hotelId).toBeNull();
    const data = m.data as { subject: string; body: string };
    expect(data.subject).toBe("Direktbuchung für Chalet Sonne");
    expect(data.body.startsWith("Wir haben uns auf der Messe gesehen.")).toBe(true);
    expect(data.body).toContain("Guten Tag Ruth Keller");
    expect(data.body).toContain("Martin");
    const [after] = await db().select().from(salesLeads).where(eq(salesLeads.id, l.id));
    expect(after.status).toBe("kontaktiert");
    expect(after.lastMailAt).not.toBeNull();
    // Mail wird gerendert (Platform-Absender, kein Betrieb)
    expect(render("sales_lead", "de", { hotel: { name: "Pontivo", contactEmail: "", contactPhone: null, checkinTime: "15:00", checkoutTime: "11:00" } as never, data: m.data as Record<string, unknown>, baseUrl: "https://x" }).subject).toBe("Direktbuchung für Chalet Sonne");
    // zweite Mail ändert den Status nicht zurück, Vorlage «Nachfassen» setzt nichts
    await sendLeadMail(l.id, "nachfassen", { senderName: "Martin" }, "t");
    expect((await mails(email)).length).toBe(2);

    await updateLead(l.id, { doNotContact: true }, "t");
    await expect(sendLeadMail(l.id, "nachfassen", { senderName: "M" }, "t")).rejects.toThrow(/nicht mehr kontaktiert/);
    const none = await createLead({ name: "Ohne Mail" }, "t");
    await expect(sendLeadMail(none.id, "erstkontakt", { senderName: "M" }, "t")).rejects.toThrow(/E-Mail/);
    await expect(sendLeadMail(l.id, "gibtsnicht", { senderName: "M" }, "t")).rejects.toThrow(/Vorlage/);
  });

  it("Abgleich: Registrierung erzeugt einen Lead, von Hand angelegter Lead wird verknüpft, online = gewonnen, zweiter Lauf ändert nichts", async () => {
    const email = `host-${uid()}@example.ch`;
    const manual = await createLead({ name: "Von Hand", email, source: "empfehlung" }, "t");
    const { hotel } = await registerHost({ propertyType: "hotel", name: `Hotel ${uid()}`, contactName: "Ruth Keller", email, canton: "GR", municipality: `Testdorf-${uid()}`, acceptTerms: true } as never);
    const other = await registerHost({ propertyType: "apartment", name: `Chalet ${uid()}`, contactName: "Hans Muster", email: `host-${uid()}@example.ch`, canton: "BE", municipality: `Testdorf-${uid()}`, acceptTerms: true } as never);
    await syncLeads();
    const [linked] = await db().select().from(salesLeads).where(eq(salesLeads.id, manual.id));
    expect(linked.hotelId).toBe(hotel.id);
    expect(linked.source).toBe("empfehlung");
    const [auto] = await db().select().from(salesLeads).where(eq(salesLeads.hotelId, other.hotel.id));
    expect(auto).toMatchObject({ source: "registrierung", status: "neu", contactName: "Hans Muster", canton: "BE" });
    const again = await syncLeads();
    expect(again.created).toBe(0);
    expect((await db().select().from(salesLeads).where(eq(salesLeads.hotelId, other.hotel.id))).length).toBe(1);

    await db().update(hotels).set({ status: "live" }).where(eq(hotels.id, other.hotel.id));
    await syncLeads();
    expect((await db().select().from(salesLeads).where(eq(salesLeads.id, auto.id)))[0].status).toBe("gewonnen");
    expect((await db().select().from(salesLeadEvents).where(eq(salesLeadEvents.leadId, auto.id))).map((e) => e.text)).toContain("Betrieb ist online → gewonnen");
  });

  it("Liste nach Status und Kennzahlen", async () => {
    const l = await createLead({ name: `Filter ${uid()}`, nextActionAt: "2020-01-01" }, "t");
    const only = await listLeads({ status: "neu" });
    expect(only.every((x) => x.status === "neu")).toBe(true);
    expect(only.some((x) => x.id === l.id)).toBe(true);
    expect((await listLeads({ status: "unsinn" })).length).toBeGreaterThanOrEqual(only.length); // unbekannter Filter = alle
    const c = await cockpit();
    expect(c.due).toBeGreaterThanOrEqual(1);
    expect(c.newThisWeek).toBeGreaterThanOrEqual(1);
    expect(c.funnel.counts.neu).toBeGreaterThanOrEqual(1);
  });
});
