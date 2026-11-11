import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as postmarkWebhook } from "../../app/api/webhooks/postmark/route";
import { db, closeDb } from "../../src/db/client";
import { emailOutbox, emailSuppressions } from "../../src/db/schema";
import { enqueueEmail } from "../../src/email/enqueue";
import { sendDueEmails, setMailer } from "../../src/email/send";

const SECRET = "pm-secret";
const basic = (pw: string) => "Basic " + Buffer.from(`postmark:${pw}`).toString("base64");
const uid = () => Math.random().toString(36).slice(2, 10);

function call(body: unknown, headers: Record<string, string> = { authorization: basic(SECRET) }) {
  return postmarkWebhook(new Request("http://localhost/api/webhooks/postmark", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}
const bounce = (email: string, over: Record<string, unknown> = {}) => ({
  RecordType: "Bounce", ID: Math.floor(Math.random() * 1e9), Type: "HardBounce", TypeCode: 1, Email: email, Inactive: true, CanActivate: true, Details: "Mailbox does not exist", ...over,
});

beforeAll(() => {
  process.env.POSTMARK_WEBHOOK_SECRET = SECRET;
});
afterAll(async () => {
  setMailer(null);
  await closeDb();
});

describe("Postmark Bounce/Spam-Webhook", () => {
  it("ohne oder mit falschem Geheimnis: 401", async () => {
    expect((await call(bounce("a@example.ch"), {})).status).toBe(401);
    expect((await call(bounce("a@example.ch"), { authorization: basic("falsch") })).status).toBe(401);
  });

  it("Header x-webhook-token funktioniert ebenfalls", async () => {
    const email = `h-${uid()}@example.ch`;
    expect((await call(bounce(email), { "x-webhook-token": SECRET })).status).toBe(200);
    expect(await db().select().from(emailSuppressions).where(eq(emailSuppressions.email, email))).toHaveLength(1);
  });

  it("harter Bounce sperrt die Adresse (klein geschrieben), doppelte Meldung ist harmlos", async () => {
    const email = `Gast-${uid()}@Example.ch`;
    const ev = bounce(email);
    expect(await (await call(ev)).json()).toMatchObject({ result: "suppressed" });
    expect(await (await call(ev)).json()).toMatchObject({ result: "duplicate" });
    const [row] = await db().select().from(emailSuppressions).where(eq(emailSuppressions.email, email.toLowerCase()));
    expect(row).toMatchObject({ reason: "bounce", bounceType: "HardBounce" });
  });

  it("vorübergehender Fehler (nicht inaktiv) sperrt nicht", async () => {
    const email = `t-${uid()}@example.ch`;
    expect(await (await call(bounce(email, { Type: "Transient", TypeCode: 2, Inactive: false }))).json()).toMatchObject({ result: "ignored" });
    expect(await db().select().from(emailSuppressions).where(eq(emailSuppressions.email, email))).toHaveLength(0);
  });

  it("Spam-Beschwerde sperrt", async () => {
    const email = `s-${uid()}@example.ch`;
    await call({ RecordType: "SpamComplaint", ID: 5555, Type: "SpamComplaint", TypeCode: 100001, Email: email, Inactive: true });
    const [row] = await db().select().from(emailSuppressions).where(eq(emailSuppressions.email, email));
    expect(row.reason).toBe("spam_complaint");
  });

  it("gesperrte Adresse bekommt keine E-Mail mehr, andere schon", async () => {
    const bad = `bad-${uid()}@example.ch`;
    const good = `good-${uid()}@example.ch`;
    await call(bounce(bad));
    const sentTo: string[] = [];
    setMailer(async (m) => {
      sentTo.push(m.to);
    });
    await enqueueEmail(db(), { hotelId: null, template: "login_link", to: bad, data: { link: "http://x" } });
    await enqueueEmail(db(), { hotelId: null, template: "login_link", to: good, data: { link: "http://x" } });
    await sendDueEmails(new Date(Date.now() + 1000), 500);
    expect(sentTo).toContain(good);
    expect(sentTo).not.toContain(bad);
    const [row] = await db().select().from(emailOutbox).where(eq(emailOutbox.toEmail, bad));
    expect(row.status).toBe("cancelled");
  });
});
