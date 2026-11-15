import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels, inboxMessages, inboxThreads, pushOutbox } from "../../src/db/schema";
import { setChannexFetch } from "../../src/integrations/channex/client";
import { closeThread, ingestWebhook, listThreads, openThread, replyToThread, unreadCount, InboxError } from "../../src/services/inbox";
import { makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => setChannexFetch(null));

async function setup() {
  const h = await makeHotel();
  const prop = crypto.randomUUID();
  await db().update(hotels).set({ channexPropertyId: prop, channexEnabled: true }).where(eq(hotels.id, h.hotel.id));
  return { h, prop };
}
const msg = (prop: string, thread: string, id: string, sender = "guest", text = "Hallo") => ({ event: "message", property_id: prop, payload: { message_thread_id: thread, id, message: text, sender, ota: "BookingCom" } });

describe("Posteingang (SPEC 19.9)", () => {
  it("speichert idempotent, zählt ungelesen, Push ohne Text, Mandantentrennung", async () => {
    const { h, prop } = await setup();
    const other = await setup();
    const t = "thr-" + crypto.randomUUID();
    expect(await ingestWebhook(msg(prop, t, "m1", "guest", "Geheimer Text"))).toBe(true);
    expect(await ingestWebhook(msg(prop, t, "m1"))).toBe(true); // Wiederholung
    await ingestWebhook(msg(prop, t, "m2"));
    expect(await unreadCount(h.hotel.id)).toBe(2);
    expect(await unreadCount(other.h.hotel.id)).toBe(0);
    expect((await listThreads(other.h.hotel.id))).toHaveLength(0);
    const [th] = (await listThreads(h.hotel.id)).map((x) => x.t);
    const opened = await openThread(h.hotel.id, th.id);
    expect(opened?.messages).toHaveLength(2);
    expect(await unreadCount(h.hotel.id)).toBe(0);
    expect(await openThread(other.h.hotel.id, th.id)).toBeNull();
    const pushes = await db().select().from(pushOutbox).where(eq(pushOutbox.hotelId, h.hotel.id));
    expect(pushes.length).toBe(2);
    expect(pushes.every((p) => !p.body.includes("Geheimer"))).toBe(true);
  });

  it("ignoriert unbekannte Betriebe; fremder Thread wird nicht übernommen", async () => {
    const { prop } = await setup();
    const other = await setup();
    expect(await ingestWebhook(msg(crypto.randomUUID(), "x", "m"))).toBe(false);
    const t = "thr-" + crypto.randomUUID();
    await ingestWebhook(msg(prop, t, "m1"));
    expect(await ingestWebhook(msg(other.prop, t, "m2"))).toBe(false);
  });

  it("Antwort und Abschliessen über Channex; Fehler speichert nichts", async () => {
    const { h, prop } = await setup();
    const t = "thr-" + crypto.randomUUID();
    await ingestWebhook(msg(prop, t, "m1"));
    const [th] = (await listThreads(h.hotel.id)).map((x) => x.t);
    const calls: string[] = [];
    setChannexFetch(async (url, init) => { calls.push(`${init.method} ${url}`); return { status: 200, json: async () => ({ data: { id: "out1" } }), text: async () => JSON.stringify({ data: { id: "out1" } }) }; });
    await replyToThread(h.hotel.id, th.id, "Gerne!", "u@x.ch");
    expect(calls[0]).toContain(`POST`);
    expect(calls[0]).toContain(`/message_threads/${t}/messages`);
    expect((await openThread(h.hotel.id, th.id))?.messages.map((m) => m.sender)).toEqual(["guest", "hotel"]);
    await expect(replyToThread(h.hotel.id, th.id, "  ", "u")).rejects.toBeInstanceOf(InboxError);
    setChannexFetch(async () => ({ status: 500, json: async () => ({}), text: async () => "boom" }));
    await expect(replyToThread(h.hotel.id, th.id, "Nochmal", "u")).rejects.toBeInstanceOf(InboxError);
    expect(await db().select().from(inboxMessages).where(eq(inboxMessages.threadId, th.id))).toHaveLength(2);
    setChannexFetch(async () => ({ status: 200, json: async () => ({}), text: async () => "{}" }));
    await closeThread(h.hotel.id, th.id, "u");
    expect(await listThreads(h.hotel.id)).toHaveLength(0);
    expect(await listThreads(h.hotel.id, { closed: true })).toHaveLength(1);
    await ingestWebhook(msg(prop, t, "m3")); // öffnet wieder
    expect(await listThreads(h.hotel.id)).toHaveLength(1);
    void and; void inboxThreads;
  });
});
