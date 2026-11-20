import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog, hotels, roomTypes, setupImports } from "../../src/db/schema";
import { adoptImport, discardImport, getImport, importFromPdf, importFromUrl, setSetupImportFetch, SetupImportError } from "../../src/services/setup-import";
import { env } from "../../src/env";
import { makeHotel } from "../helpers";

afterAll(closeDb);
beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key"; });
afterEach(() => { setSetupImportFetch(null, null); delete process.env.ANTHROPIC_API_KEY; });

const PAGE = `<html><body><h1>Hotel Test</h1><p>${"Willkommen im Haus mit schönen Zimmern und Blick auf den See. ".repeat(8)}</p><a href="/zimmer">Zimmer</a></body></html>`;
let calls = 0;
const ai = (text: string) => async () => { calls++; return { status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 300 } }) }; };
const DRAFT = JSON.stringify({ intro: "Ein kleines Haus am See.", rooms: [{ name: "Seezimmer", description: "Mit Balkon", maxAdults: 2, maxChildren: 1, roomCount: 3 }, { name: "Suite", maxAdults: 4, roomCount: 1 }], faq: [{ q: "Haustiere?", a: "Auf Anfrage." }] });
const pages = async (u: string) => (u.endsWith("/zimmer") ? PAGE : PAGE);
async function subscribed() {
  const { hotel } = await makeHotel({});
  await db().update(hotels).set({ billingPaymentMethodId: "pm_test", hostTermsAcceptedAt: new Date() }).where(eq(hotels.id, hotel.id));
  return (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
}

describe("KI-Einrichtung", () => {
  it("ohne Abo (keine Karte) kein Lauf und kein KI-Aufruf", async () => {
    const { hotel } = await makeHotel({});
    calls = 0;
    setSetupImportFetch(ai(DRAFT), pages);
    await expect(importFromUrl(hotel, "https://www.example-hotel.ch", "t")).rejects.toThrow(/Karte|Bedingungen/);
    expect(calls).toBe(0);
    expect(await db().select().from(setupImports).where(eq(setupImports.hotelId, hotel.id))).toHaveLength(0);
  });

  it("Entwurf aus Website, Übernahme legt Zimmer ohne Preise und FAQ an, doppelt übernehmen geht nicht, Entwurfsdaten werden gelöscht", async () => {
    const hotel = await subscribed();
    setSetupImportFetch(ai(DRAFT), pages);
    const id = await importFromUrl(hotel, "https://www.example-hotel.ch", "t");
    const imp = (await getImport(hotel.id, id))!;
    expect(imp.status).toBe("draft");
    expect(imp.inputTokens).toBe(1000);
    const r = await adoptImport(hotel, id, { intro: true, rooms: [0, 1, 7], faq: [0] }, "t");
    expect(r).toEqual({ rooms: 2, skippedRooms: 0, faq: 1, intro: true });
    const rt = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
    expect(rt.map((x) => x.name)).toEqual(expect.arrayContaining(["Seezimmer", "Suite"]));
    expect(rt).toHaveLength(3); // das Zimmer aus makeHotel plus die zwei übernommenen
    expect(rt.find((x) => x.name === "Seezimmer")).toMatchObject({ roomCount: 3, maxAdults: 2, maxChildren: 1, maxOccupancy: 3 });
    expect((await getImport(hotel.id, id))).toMatchObject({ status: "adopted", draft: {} });
    await expect(adoptImport(hotel, id, { intro: false, rooms: [0], faq: [] }, "t")).rejects.toThrow(SetupImportError);
    const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
    expect(h.content.de?.intro).toBe("Ein kleines Haus am See.");
    const log = await db().select().from(auditLog).where(eq(auditLog.hotelId, hotel.id));
    expect(log.some((l) => l.action === "setup_import.adopt")).toBe(true);
  });

  it("Monatslimit stoppt vor dem KI-Aufruf; nicht erreichbare Website verbraucht kein Kontingent", async () => {
    const hotel = await subscribed();
    setSetupImportFetch(ai(DRAFT), async () => { throw new Error("Zeitüberschreitung"); });
    await expect(importFromUrl(hotel, "https://www.example-hotel.ch", "t")).rejects.toThrow(/nicht geladen/);
    expect(await db().select().from(setupImports).where(eq(setupImports.hotelId, hotel.id))).toHaveLength(0);
    setSetupImportFetch(ai(DRAFT), pages);
    const n = env().SETUP_RUNS_PER_MONTH;
    for (let i = 0; i < n; i++) await importFromUrl(hotel, "https://www.example-hotel.ch", "t");
    calls = 0;
    await expect(importFromUrl(hotel, "https://www.example-hotel.ch", "t")).rejects.toThrow(/Monatslimit/);
    expect(calls).toBe(0);
  });

  it("unbrauchbare KI-Antwort: Lauf als fehlgeschlagen, zählt zum Limit; bestehende Zimmer werden nicht doppelt angelegt; verwerfen löscht den Entwurf", async () => {
    const hotel = await subscribed();
    setSetupImportFetch(ai("Tut mir leid"), pages);
    await expect(importFromUrl(hotel, "https://www.example-hotel.ch", "t")).rejects.toThrow(/nichts Verlässliches/);
    expect((await db().select().from(setupImports).where(eq(setupImports.hotelId, hotel.id)))[0].status).toBe("failed");
    setSetupImportFetch(ai(DRAFT), pages);
    const id = await importFromUrl(hotel, "https://www.example-hotel.ch", "t");
    await adoptImport(hotel, id, { intro: false, rooms: [0], faq: [] }, "t");
    const id2 = await importFromUrl(hotel, "https://www.example-hotel.ch", "t");
    expect(await adoptImport(hotel, id2, { intro: false, rooms: [0, 1], faq: [] }, "t")).toMatchObject({ rooms: 1, skippedRooms: 1 });
    // verwerfen
    const h2 = await subscribed();
    const id3 = await importFromUrl(h2, "https://www.example-hotel.ch", "t");
    await discardImport(h2.id, id3, "t");
    expect(await getImport(h2.id, id3)).toMatchObject({ status: "discarded", draft: {} });
  });

  it("PDF: Grenzen vor dem KI-Aufruf, gültiges PDF geht als Dokument an die KI", async () => {
    const hotel = await subscribed();
    calls = 0;
    await expect(importFromPdf(hotel, new TextEncoder().encode("kein pdf"), "x.pdf", "t")).rejects.toThrow(/kein PDF/);
    await expect(importFromPdf(hotel, Buffer.from("%PDF-1.4 " + "/Type /Page ".repeat(30)), "x.pdf", "t")).rejects.toThrow(/zu viele Seiten/);
    expect(calls).toBe(0);
    let body = "";
    setSetupImportFetch(async (_u, init) => { body = init.body; return ai(DRAFT)(); }, null);
    const id = await importFromPdf(hotel, Buffer.from("%PDF-1.4 /Type /Page"), "Prospekt.pdf", "t");
    expect(JSON.parse(body).messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(JSON.parse(body).max_tokens).toBe(3000);
    expect((await getImport(hotel.id, id))?.source).toBe("Prospekt.pdf");
  });
});
