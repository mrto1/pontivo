import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog } from "../../src/db/schema";
import { getSiteOverrides, resetSiteOverrides, saveSiteOverrides } from "../../src/services/platform-site";

afterAll(async () => { await resetSiteOverrides("test"); await closeDb(); });

describe("Pontivo-Website-Texte speichern", () => {
  it("speichern, lesen, ändern, zurücksetzen, Protokoll", async () => {
    await resetSiteOverrides("test");
    expect(await getSiteOverrides()).toBeNull();
    await saveSiteOverrides({ texts: { "hero.title": "Mein Titel", "unbekannt": "x" }, faq: [{ q: "F", a: "A" }] }, "user:t");
    expect(await getSiteOverrides()).toEqual({ texts: { "hero.title": "Mein Titel" }, faq: [{ q: "F", a: "A" }] });
    await saveSiteOverrides({ texts: { "hero.title": "Anderer Titel" }, faq: [] }, "user:t");
    expect(await getSiteOverrides()).toEqual({ texts: { "hero.title": "Anderer Titel" }, faq: null });
    const log = await db().select().from(auditLog).where(eq(auditLog.action, "platform.site_texts"));
    expect(log.length).toBeGreaterThanOrEqual(2);
    await resetSiteOverrides("user:t");
    expect(await getSiteOverrides()).toBeNull();
  });
});
