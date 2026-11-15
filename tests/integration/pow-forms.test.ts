import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "../../src/db/client";
import { inquiries } from "../../src/db/schema";
import { eq } from "drizzle-orm";

// Rechenaufgabe erzwingen, bevor env() zum ersten Mal gelesen wird
vi.hoisted(() => { process.env.POW_REQUIRED = "1"; });
import { GET as powGet, POST as powPost } from "../../app/api/pow/route";
import { POST as inquiryPost } from "../../app/api/inquiry/route";
import { POST as chatPost } from "../../app/api/chat/route";
import { leadingZeroBits } from "../../src/lib/pow";
import { makeHotel } from "../helpers";

afterAll(closeDb);

let ipN = 0;
const ip = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;
async function solve(): Promise<string> {
  const c = await (await powGet(new Request("http://x/api/pow", { headers: { "x-forwarded-for": ip() } }))).json();
  for (let n = 0; ; n++) if (leadingZeroBits(crypto.createHash("sha256").update(c.salt + n).digest()) >= c.bits) return `${c.token}.${n}`;
}
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const inquiry = (slug: string, extra: Record<string, string>, email = `g-${Math.random().toString(36).slice(2)}@example.ch`) =>
  inquiryPost(new Request("http://localhost/api/inquiry", { method: "POST", headers: { "x-forwarded-for": ip() }, body: form({ hotel: slug, back: "/h/x/de", kind: "other", name: "Test", email, message: "Hallo", ...extra }) }));

describe("Gäste-Formulare mit Rechenaufgabe (SPEC 18.11)", () => {
  let slug = "", hotelId = "";
  beforeAll(async () => { const h = await makeHotel(); slug = h.hotel.slug; hotelId = h.hotel.id; });

  it("Anfrage: ohne Lösung abgelehnt, mit Lösung angenommen, Wiederverwendung abgelehnt", async () => {
    const none = await inquiry(slug, {});
    expect(none.headers.get("location")).toContain("#anfrage-fehler");
    const proof = await solve();
    const ok = await inquiry(slug, { _pow: proof });
    expect(ok.headers.get("location")).toContain("#anfrage-gesendet");
    const replay = await inquiry(slug, { _pow: proof });
    expect(replay.headers.get("location")).toContain("#anfrage-fehler");
    expect((await db().select().from(inquiries).where(eq(inquiries.hotelId, hotelId))).length).toBe(1);
  });

  it("Anfrage: Grenze je E-Mail-Adresse (5 pro Stunde)", async () => {
    const email = `limit-${Math.random().toString(36).slice(2)}@example.ch`;
    const results: string[] = [];
    for (let i = 0; i < 6; i++) results.push((await inquiry(slug, { _pow: await solve() }, email)).headers.get("location") ?? "");
    expect(results.slice(0, 5).every((l) => l.includes("#anfrage-gesendet"))).toBe(true);
    expect(results[5]).toContain("#anfrage-fehler");
  });

  it("Chat: ohne Pass 400, Pass nur gegen gelöste Aufgabe", async () => {
    const h = await makeHotel();
    const post = (body: unknown) => chatPost(new Request("http://x/api/chat", { method: "POST", headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ hotel: h.hotel.slug, ...(body as object) }) }));
    expect((await post({ messages: [] })).status).toBe(400);
    expect((await powPost(new Request("http://x/api/pow", { method: "POST", body: JSON.stringify({ proof: "x.1" }) }))).status).toBe(400);
    const r = await powPost(new Request("http://x/api/pow", { method: "POST", headers: { "x-forwarded-for": ip() }, body: JSON.stringify({ proof: await solve() }) }));
    const { pass } = await r.json();
    expect(pass).toBeTruthy();
    const withPass = await (await post({ messages: [], pass })).json();
    expect(withPass.status).not.toBe("pow");
  });
});
