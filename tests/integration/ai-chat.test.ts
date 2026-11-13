import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, rows } from "../../src/db/client";
import { aiUsage, hotelModules, hotels, inquiries, platformCharges } from "../../src/db/schema";
import { aiChatActive, AiModuleError, cancelAiChat, enableAiChat, setAiBudget } from "../../src/services/ai-module";
import { handleChat, setChatFetch } from "../../src/services/chat";
import { runMonthlyMinimum } from "../../src/services/billing";
import { shiftMonth } from "../../src/services/overview";
import { setPaymentProvider } from "../../src/payments/provider";
import { FakePaymentProvider } from "../../src/payments/fake";
import { addBlock, createPage, updateBlock } from "../../src/services/site";
import { todayIn } from "../../src/domain/dates";
import { POST as chatPost } from "../../app/api/chat/route";
import { POST as forwardPost } from "../../app/api/chat/forward/route";
import { makeHotel } from "../helpers";

afterAll(closeDb);
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  setChatFetch(null);
  setPaymentProvider(null);
  delete process.env.ANTHROPIC_API_KEY;
});

type Call = { system: string; messages: { role: string; content: string }[]; model: string };
function fakeModel(reply = "Das Frühstück gibt es von 7 bis 10 Uhr.", usage = { input_tokens: 1200, output_tokens: 40 }) {
  const calls: Call[] = [];
  setChatFetch(async (_url, init) => {
    const b = JSON.parse(init.body);
    expect(init.headers["x-api-key"]).toBe("test-key");
    calls.push({ system: b.system, messages: b.messages, model: b.model });
    return { status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: reply }], usage }) };
  });
  return calls;
}

async function liveHotel(opts: { card?: boolean } = {}) {
  const h = await makeHotel();
  await db().update(hotels).set({ monthlyMinimumRappen: 0, ...(opts.card === false ? {} : { billingCustomerId: "cus_t", billingPaymentMethodId: "pm_t", billingCardLabel: "Testkarte" }) }).where(eq(hotels.id, h.hotel.id));
  return (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
}
const plan = { basic: 1900 };
async function enable(hotel: Awaited<ReturnType<typeof liveHotel>>) {
  await enableAiChat(hotel, "basic", plan.basic, "owner@test");
  return (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
}
/** Konditionen direkt setzen (kleine Zahlen, damit Tests kurz bleiben) */
async function setTerms(hotelId: string, terms: Partial<{ included: number; packSize: number; packPriceRappen: number; priceRappen: number }>, extra: Record<string, unknown> = {}) {
  const [m] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, "ai_chat")));
  const s = m.settings as { terms: Record<string, unknown> };
  await db().update(hotelModules).set({ settings: { ...s, ...extra, terms: { ...s.terms, ...terms } } }).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, "ai_chat")));
}
const q = (content: string) => [{ role: "user", content }];
const count = async (hotelId: string) => (await db().select().from(aiUsage).where(eq(aiUsage.hotelId, hotelId))).length;

describe("KI-Chat: Modul einschalten", () => {
  it("braucht Karte und die richtige Preisbestätigung; nicht angebotene Tarife sind gesperrt; Konditionen werden kopiert", async () => {
    const noCard = await liveHotel({ card: false });
    await expect(enableAiChat(noCard, "basic", 1900, "o")).rejects.toThrow(/Karte/);
    const h = await liveHotel();
    await expect(enableAiChat(h, "basic", 1800, "o")).rejects.toThrow(/Preis/);
    await expect(enableAiChat(h, "mini", 490, "o")).rejects.toBeInstanceOf(AiModuleError); // Mini ist (noch) nicht freigeschaltet
    await enableAiChat(h, "basic", 1900, "o");
    const [m] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, h.id), eq(hotelModules.module, "ai_chat")));
    expect(m.enabled).toBe(true);
    expect(m.settings).toMatchObject({ terms: { planCode: "basic", priceRappen: 1900, included: 250, packSize: 100, packPriceRappen: 500, acceptedBy: "o" }, overageBudgetRappen: 0, endsAt: null });
    expect((m.settings as { freeMonth: string }).freeMonth).toBe(todayIn("Europe/Zurich").slice(0, 7));
    expect((await aiChatActive(h)).active).toBe(true);
  });

  it("Kündigung wirkt zum Monatsende; Budget nur mit Zusatzpaketen", async () => {
    const h = await enable(await liveHotel());
    await setAiBudget(h, 1000, "o");
    await expect(setAiBudget(h, -5, "o")).rejects.toBeInstanceOf(AiModuleError);
    await cancelAiChat(h, "o");
    const [m] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, h.id), eq(hotelModules.module, "ai_chat")));
    const ends = (m.settings as { endsAt: string }).endsAt;
    expect(ends >= todayIn("Europe/Zurich") && ends.slice(0, 7) === todayIn("Europe/Zurich").slice(0, 7)).toBe(true);
    expect((await aiChatActive(h)).active).toBe(true);
    expect((await aiChatActive(h, new Date(Date.now() + 40 * 864e5))).active).toBe(false);
    // Kündigung zurücknehmen: erneut einschalten behält den Beginn
    await enableAiChat(h, "basic", 1900, "o");
    const [m2] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, h.id), eq(hotelModules.module, "ai_chat")));
    expect(m2.settings).toMatchObject({ endsAt: null, enabledSince: (m.settings as { enabledSince: string }).enabledSince, overageBudgetRappen: 1000 });
  });
});

describe("KI-Chat: Antworten", () => {
  it("Modul aus oder ohne API-Schlüssel: keine Antwort, kein Aufruf des Modells", async () => {
    const calls = fakeModel();
    const h = await liveHotel();
    expect(await handleChat(h, { messages: q("Hallo"), lang: "de", surface: "site" })).toEqual({ status: "off" });
    const on = await enable(h);
    delete process.env.ANTHROPIC_API_KEY;
    expect(await handleChat(on, { messages: q("Hallo"), lang: "de", surface: "site" })).toEqual({ status: "off" });
    expect(calls).toHaveLength(0);
    expect(await count(h.id)).toBe(0);
  });

  it("Prompt: nur Wissen des eigenen Hotels, keine Zimmerpreise; Antwort, Tokens und Gespräch werden gezählt (ohne Text)", async () => {
    const calls = fakeModel();
    const a = await enable(await liveHotel());
    const other = await makeHotel({ name: "Fremdes Haus Zebra" });
    const p = await createPage(a.id, "Fragen", "t");
    const fid = await addBlock(a.id, p.id, "faq", "t");
    await updateBlock(a.id, p.id, fid, { id: fid, type: "faq", heading: {}, items: [{ q: { de: "Gibt es Parkplätze?" }, a: { de: "Ja, gratis vor dem Haus." } }] }, "t");
    const r = await handleChat(a, { messages: q("Gibt es Parkplätze?"), lang: "de", surface: "site" });
    expect(r).toMatchObject({ status: "ok", reply: "Das Frühstück gibt es von 7 bis 10 Uhr.", forward: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("claude-haiku-5-5");
    expect(calls[0].system).toContain(a.name);
    expect(calls[0].system).toContain("Ja, gratis vor dem Haus.");
    expect(calls[0].system).not.toContain(other.hotel.name);
    expect(calls[0].system).not.toMatch(/18000|180\.00/); // Zimmerpreis des Doppelzimmers
    expect(calls[0].system).toContain("Never quote room rates");
    const [u] = await db().select().from(aiUsage).where(eq(aiUsage.hotelId, a.id));
    expect(u).toMatchObject({ messages: 1, inputTokens: 1200, outputTokens: 40, surface: "site" });
  });

  it("ai_usage speichert nur Zähler, keine Texte", async () => {
    const cols = rows<{ column_name: string }>(await db().execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage' ORDER BY column_name`)).map((c) => c.column_name);
    expect(cols).toEqual(["hotel_id", "id", "input_tokens", "last_at", "messages", "month", "output_tokens", "started_at", "surface"]);
  });

  it("Gespräch zählt einmal pro Sitzung; nach 30 Minuten Pause beginnt ein neues; fremde Sitzung wird nicht weitergeführt", async () => {
    fakeModel();
    const a = await enable(await liveHotel());
    const b = await enable(await liveHotel());
    const t0 = new Date();
    const r1 = await handleChat(a, { messages: q("Eins"), lang: "de", surface: "site" }, t0);
    if (r1.status !== "ok") throw new Error("erwartet ok");
    await handleChat(a, { session: r1.session, messages: q("Zwei"), lang: "de", surface: "site" }, new Date(t0.getTime() + 5 * 60_000));
    expect(await count(a.id)).toBe(1);
    expect((await db().select().from(aiUsage).where(eq(aiUsage.id, r1.session)))[0].messages).toBe(2);
    const r3 = await handleChat(a, { session: r1.session, messages: q("Drei"), lang: "de", surface: "site" }, new Date(t0.getTime() + 40 * 60_000));
    expect(r3.status === "ok" && r3.session !== r1.session).toBe(true);
    expect(await count(a.id)).toBe(2);
    // Hotel B kennt die Sitzung von Hotel A nicht
    await handleChat(b, { session: r1.session, messages: q("Hallo"), lang: "de", surface: "site" });
    expect(await count(b.id)).toBe(1);
    expect((await db().select().from(aiUsage).where(eq(aiUsage.id, r1.session)))[0].messages).toBe(2);
  });

  it("Limits: leere, zu lange oder falsch aufgebaute Nachrichten werden abgelehnt, ohne Aufruf", async () => {
    const calls = fakeModel();
    const a = await enable(await liveHotel());
    for (const bad of [[], q(""), q("x".repeat(501)), [{ role: "assistant", content: "Hi" }], "text", [{ role: "system", content: "x" }]]) {
      expect((await handleChat(a, { messages: bad, lang: "de", surface: "site" })).status).toBe("invalid");
    }
    expect(calls).toHaveLength(0);
    expect(await count(a.id)).toBe(0);
  });

  it("Weiterleitungs-Marker wird erkannt und dem Gast nicht gezeigt; Sprache folgt dem Hotel", async () => {
    const calls = fakeModel("Das weiss ich leider nicht. [[FORWARD]]");
    const a = await enable(await liveHotel());
    const r = await handleChat(a, { messages: q("Gibt es eine Sauna?"), lang: "xx", surface: "booking" });
    expect(r).toMatchObject({ status: "ok", reply: "Das weiss ich leider nicht.", forward: true });
    expect(calls[0].system).toContain("Deutsch");
    expect(calls[0].system).toContain("booking page");
    expect((await db().select().from(aiUsage).where(eq(aiUsage.hotelId, a.id)))[0].surface).toBe("booking");
  });

  it("Fehler des Dienstes: Fehlermeldung, ein fehlgeschlagener erster Aufruf zählt nicht", async () => {
    setChatFetch(async () => ({ status: 529, text: async () => "overloaded" }));
    const a = await enable(await liveHotel());
    const r = await handleChat(a, { messages: q("Hallo"), lang: "de", surface: "site" });
    expect(r.status).toBe("error");
    expect(await count(a.id)).toBe(0);
  });
});

describe("KI-Chat: Kontingent", () => {
  it("Limit erreicht ohne Budget: Pause, kein Aufruf; mit Budget: Zusatzpakete, dann wieder Pause", async () => {
    const calls = fakeModel();
    let a = await enable(await liveHotel());
    await setTerms(a.id, { included: 2, packSize: 2, packPriceRappen: 500 });
    const now = new Date();
    const talk = (n: number) => handleChat(a, { messages: q(`Frage ${n}`), lang: "de", surface: "site" }, now);
    expect((await talk(1)).status).toBe("ok");
    expect((await talk(2)).status).toBe("ok");
    const paused = await talk(3);
    expect(paused.status).toBe("paused");
    expect(calls).toHaveLength(2);
    expect(await count(a.id)).toBe(2);
    // Budget für ein Paket (CHF 5): 2 weitere Gespräche
    await setAiBudget(a, 500, "o");
    a = (await db().select().from(hotels).where(eq(hotels.id, a.id)))[0];
    expect((await talk(3)).status).toBe("ok");
    expect((await talk(4)).status).toBe("ok");
    expect((await talk(5)).status).toBe("paused");
    expect(await count(a.id)).toBe(4);
  });

  it("technische Obergrenze gilt auch mit Budget", async () => {
    fakeModel();
    process.env.AI_CHAT_HARD_CAP = "1";
    try {
      const a = await enable(await liveHotel());
      await setTerms(a.id, { included: 5, packSize: 5, packPriceRappen: 100 }, { overageBudgetRappen: 10_000 });
      expect((await handleChat(a, { messages: q("A"), lang: "de", surface: "site" })).status).toBe("ok");
      expect((await handleChat(a, { messages: q("B"), lang: "de", surface: "site" })).status).toBe("paused");
    } finally {
      delete process.env.AI_CHAT_HARD_CAP;
    }
  });

  it("gleichzeitige neue Gespräche überschreiten das Limit nicht", async () => {
    fakeModel();
    const a = await enable(await liveHotel());
    await setTerms(a.id, { included: 3 });
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => handleChat(a, { messages: q(`F${i}`), lang: "de", surface: "site" })));
    expect(res.filter((r) => r.status === "ok")).toHaveLength(3);
    expect(await count(a.id)).toBe(3);
  });
});

describe("KI-Chat: Abrechnung", () => {
  const lastMonth = () => shiftMonth(todayIn("Europe/Zurich").slice(0, 7), -1);
  async function billed(opts: { min?: number; freeMonth?: string; conversations: number; budget?: number; included?: number }) {
    const h0 = await enable(await liveHotel());
    await setTerms(h0.id, { included: opts.included ?? 2, packSize: 2, packPriceRappen: 500 }, {
      enabledSince: "2026-01-05", freeMonth: opts.freeMonth ?? "2026-01", overageBudgetRappen: opts.budget ?? 0,
    });
    await db().update(hotels).set({ status: "live", liveSince: new Date(Date.now() - 120 * 864e5), monthlyMinimumRappen: opts.min ?? 0 }).where(eq(hotels.id, h0.id));
    for (let i = 0; i < opts.conversations; i++) await db().insert(aiUsage).values({ hotelId: h0.id, month: lastMonth(), messages: 1 });
    return h0;
  }
  const charge = async (id: string) => (await db().select().from(platformCharges).where(eq(platformCharges.hotelId, id)))[0];

  it("Betrag = Mindestgebühr-Differenz + Modulpreis + Zusatzpakete; nur eine Belastung, einmal pro Monat", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    // 5 Gespräche, 2 inklusive → 3 darüber = 2 Pakete, Budget CHF 5 erlaubt nur 1 Paket
    const a = await billed({ min: 1900, conversations: 5, budget: 500 });
    // Gratismonat: Modul kostet nichts, Pakete trotzdem
    const b = await billed({ min: 0, conversations: 3, budget: 500, freeMonth: lastMonth() });
    // Ohne Nutzung, ohne Mindestgebühr: nur der Modulpreis
    const c = await billed({ min: 0, conversations: 0 });
    await runMonthlyMinimum();
    expect(await charge(a.id)).toMatchObject({ month: lastMonth(), minimumRappen: 1900, chargeRappen: 1900 + 1900 + 500, aiModuleRappen: 1900, aiPacksRappen: 500, status: "succeeded" });
    expect(await charge(b.id)).toMatchObject({ aiModuleRappen: 0, aiPacksRappen: 500, chargeRappen: 500 });
    expect(await charge(c.id)).toMatchObject({ aiModuleRappen: 1900, aiPacksRappen: 0, chargeRappen: 1900 });
    expect(fake.charges.find((x) => x.hotel.id === a.id)!.amountRappen).toBe(4300);
    const n = fake.charges.length;
    await runMonthlyMinimum();
    expect(fake.charges.length).toBe(n);
  });

  it("gekündigtes Modul wird nach dem Ende nicht mehr berechnet", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const h = await billed({ conversations: 0 });
    await setTerms(h.id, {}, { endsAt: `${shiftMonth(lastMonth(), -1)}-28` });
    await runMonthlyMinimum();
    expect(await charge(h.id)).toBeUndefined();
  });
});

describe("KI-Chat: API", () => {
  const post = (host: string, body: unknown) => new Request("http://x/api/chat", { method: "POST", headers: { host, "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });

  it("unbekanntes Hotel und ausgeschaltetes Modul: 404; sonst Antwort mit Sitzung", async () => {
    fakeModel();
    const h = await liveHotel();
    expect((await chatPost(post("unbekannt.test", { messages: q("Hallo") }))).status).toBe(404);
    expect((await chatPost(post(h.primaryDomain!, { messages: q("Hallo") }))).status).toBe(404);
    await enable(h);
    const res = await chatPost(post(h.primaryDomain!, { messages: q("Hallo"), lang: "de" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", reply: expect.any(String), session: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect((await chatPost(post(h.primaryDomain!, { messages: q("") }))).status).toBe(400);
  });

  it("Weiterleitung: wird eine normale Anfrage mit Verlauf", async () => {
    fakeModel();
    const h = await enable(await liveHotel());
    const req = (body: unknown) => new Request("http://x/api/chat/forward", { method: "POST", headers: { host: h.primaryDomain!, "content-type": "application/json", "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });
    const bad = await forwardPost(req({ name: "", email: "kaputt", transcript: [] }));
    expect(bad.status).toBe(400);
    const ok = await forwardPost(req({ name: "Anna Muster", email: "anna@example.ch", lang: "de", transcript: [{ role: "user", content: "Gibt es eine Sauna?" }, { role: "assistant", content: "Das weiss ich nicht." }] }));
    expect(ok.status).toBe(200);
    const [inq] = await db().select().from(inquiries).where(eq(inquiries.hotelId, h.id));
    expect(inq).toMatchObject({ kind: "other", name: "Anna Muster", email: "anna@example.ch" });
    expect(inq.message).toContain("Gast: Gibt es eine Sauna?");
    expect(inq.message).toContain("Assistent: Das weiss ich nicht.");
  });
});
