import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels } from "../../src/db/schema";
import { enableAiChat, setAiBooking } from "../../src/services/ai-module";
import { handleChat, setChatFetch, MAX_TOOL_ROUNDS } from "../../src/services/chat";
import { decodeOption, encodeOption } from "../../src/services/chat-booking";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);
beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key"; });
afterEach(() => { setChatFetch(null); delete process.env.ANTHROPIC_API_KEY; });

type Req = { system: string; tools?: unknown[]; messages: { role: string; content: unknown }[] };

async function hotelWithChat(booking: boolean) {
  const h = await makeHotel();
  await db().update(hotels).set({ monthlyMinimumRappen: 0, billingCustomerId: "cus_t", billingPaymentMethodId: "pm_t", billingCardLabel: "T" }).where(eq(hotels.id, h.hotel.id));
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  await enableAiChat(hotel, "basic", 1900, "owner@test");
  if (booking) await setAiBooking(hotel, true, "owner@test");
  return { hotel: (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0], rooms: h.rooms };
}

/** Skript: Modell ruft check_stay, dann show_offer mit der option_id aus dem Ergebnis, dann antwortet es */
function scripted(checkin: string, checkout: string) {
  const reqs: Req[] = [];
  let step = 0;
  setChatFetch(async (_u, init) => {
    const b = JSON.parse(init.body) as Req;
    reqs.push(b);
    step++;
    const usage = { input_tokens: 100, output_tokens: 10 };
    if (step === 1) return { status: 200, text: async () => JSON.stringify({ stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t1", name: "check_stay", input: { checkin, checkout, adults: 2, children: 0 } }] }) };
    if (step === 2) {
      const last = b.messages[b.messages.length - 1].content as { content: string }[];
      const res = JSON.parse(last[0].content) as { options: { option_id: string }[] };
      return { status: 200, text: async () => JSON.stringify({ stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t2", name: "show_offer", input: { option_id: res.options[0].option_id } }] }) };
    }
    return { status: 200, text: async () => JSON.stringify({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "Hier ist Ihr Angebot." }] }) };
  });
  return reqs;
}

describe("Buchender KI-Chat (SPEC 14f)", () => {
  it("prüft Verfügbarkeit per Werkzeug und liefert eine vom Server erzeugte Angebotskarte", async () => {
    const { hotel } = await hotelWithChat(true);
    const checkin = inDays(40), checkout = addDays(checkin, 2);
    const reqs = scripted(checkin, checkout);
    const out = await handleChat(hotel, { messages: [{ role: "user", content: "Haben Sie Platz für 2 Personen?" }], lang: "de" });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.reply).toBe("Hier ist Ihr Angebot.");
    expect(out.cards).toHaveLength(1);
    const c = out.cards![0];
    expect(c).toMatchObject({ checkin, checkout, nights: 2, adults: 2 });
    expect(c.totalRappen).toBeGreaterThan(0);
    expect(c.total).toMatch(/CHF|\d/);
    expect(c.href).toContain(`/de/book?checkin=${checkin}&checkout=${checkout}&adults=2&children=0`);
    expect(c.href).toContain("&plan=");
    // Werkzeuge und Regeln gingen mit
    expect(reqs[0].tools?.length).toBe(2);
    expect(reqs[0].system).toContain("check_stay");
    expect(reqs[0].system).toContain("NEVER ask for or accept names");
    expect(reqs).toHaveLength(3);
  });

  it("ohne Einschalten: keine Werkzeuge, alter Prompt", async () => {
    const { hotel } = await hotelWithChat(false);
    const reqs = scripted(inDays(40), inDays(42));
    setChatFetch(async (_u, init) => {
      reqs.push(JSON.parse(init.body));
      return { status: 200, text: async () => JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "ok" }] }) };
    });
    const out = await handleChat(hotel, { messages: [{ role: "user", content: "Preis?" }], lang: "de" });
    expect(out.status).toBe("ok");
    expect(reqs.at(-1)!.tools).toBeUndefined();
    expect(reqs.at(-1)!.system).toContain("Never quote room rates");
  });

  it("Werkzeug-Schleife ist begrenzt", async () => {
    const { hotel } = await hotelWithChat(true);
    let n = 0;
    setChatFetch(async () => {
      n++;
      return { status: 200, text: async () => JSON.stringify({ stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: `t${n}`, name: "check_stay", input: { checkin: "kaputt", checkout: "x", adults: 2 } }] }) };
    });
    const out = await handleChat(hotel, { messages: [{ role: "user", content: "hallo" }], lang: "de" });
    expect(out.status).toBe("error");
    expect(n).toBe(MAX_TOOL_ROUNDS);
  });

  it("option_id: nur gültige Angaben; erfundene Zimmer liefern keine Karte", async () => {
    expect(decodeOption("müll")).toBeNull();
    expect(decodeOption(encodeOption({ checkin: "2027-01-10", checkout: "2027-01-12", adults: 2, children: 1, ages: [7], roomTypeId: "11111111-1111-1111-1111-111111111111", ratePlanId: "22222222-2222-2222-2222-222222222222" }))).toMatchObject({ children: 1, ages: [7] });
    expect(decodeOption("2027-01-10|2027-01-12|99|0||11111111-1111-1111-1111-111111111111|22222222-2222-2222-2222-222222222222")).toBeNull();
    const { hotel } = await hotelWithChat(true);
    const fake = encodeOption({ checkin: inDays(40), checkout: inDays(42), adults: 2, children: 0, ages: [], roomTypeId: "11111111-1111-1111-1111-111111111111", ratePlanId: "22222222-2222-2222-2222-222222222222" });
    let step = 0;
    setChatFetch(async () => {
      step++;
      return { status: 200, text: async () => JSON.stringify(step === 1
        ? { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "t1", name: "show_offer", input: { option_id: fake } }] }
        : { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Leider nicht mehr verfügbar." }] }) };
    });
    const out = await handleChat(hotel, { messages: [{ role: "user", content: "buchen" }], lang: "de" });
    expect(out.status === "ok" && out.cards).toBeFalsy();
  });

  it("Einschalten nur bei laufendem Modul", async () => {
    const h = await makeHotel();
    await expect(setAiBooking(h.hotel, true, "x")).rejects.toThrow();
  });
});
