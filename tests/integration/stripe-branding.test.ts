import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { hotels } from "../../src/db/schema";
import { applyStripeBranding, BrandingError } from "../../src/integrations/stripe/branding";
import { setStripeClient, type Stripe } from "../../src/integrations/stripe/client";
import { registerHost } from "../../src/services/onboarding";
import { setLogo } from "../../src/services/brand";
import { saveImage } from "../../src/lib/storage";
import { uid } from "../helpers";

afterAll(async () => { setStripeClient(null); await closeDb(); });

const png = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
};
const stub = () => {
  const calls: { files: unknown[]; update: unknown[] } = { files: [], update: [] };
  setStripeClient({
    files: { create: async (p: unknown, o: unknown) => { calls.files.push({ p, o }); return { id: `file_${calls.files.length}` }; } },
    v2: { core: { accounts: { update: async (id: string, p: unknown) => { calls.update.push({ id, p }); return {}; } } } },
  } as unknown as Stripe);
  return calls;
};
const mk = async () => {
  const { hotel } = await registerHost({ propertyType: "hotel", name: `Hotel ${uid()}`, contactName: "Ruth", email: `b-${uid()}@example.ch`, canton: "GR", municipality: `T-${uid()}`, acceptTerms: true } as never);
  await db().update(hotels).set({ stripeAccountId: `acct_${uid()}` }).where(eq(hotels.id, hotel.id));
  return (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0];
};

describe("Stripe-Branding aus Logo und Hauptfarbe", () => {
  it("ohne Stripe-Konto: Fehler", async () => {
    const { hotel } = await registerHost({ propertyType: "hotel", name: `Hotel ${uid()}`, contactName: "Ruth", email: `b-${uid()}@example.ch`, canton: "GR", municipality: `T-${uid()}`, acceptTerms: true } as never);
    await expect(applyStripeBranding(hotel, "t")).rejects.toThrow(BrandingError);
  });

  it("nur Farbe, wenn es kein Logo gibt", async () => {
    const calls = stub();
    const h = await mk();
    const r = await applyStripeBranding(h, "t");
    expect(r).toMatchObject({ logo: false, icon: false });
    expect(calls.files).toHaveLength(0);
    expect(calls.update[0]).toMatchObject({ id: h.stripeAccountId, p: { configuration: { merchant: { branding: { primary_color: "#2f5d50", secondary_color: "#2f5d50" } } } } });
  });

  it("quadratisches Logo geht als Logo und Icon, ein breites nur als Logo", async () => {
    const root = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
    await fs.mkdir(root, { recursive: true });
    for (const [w, h, expectIcon] of [[256, 256, true], [400, 100, false]] as const) {
      const calls = stub();
      const hotel = await mk();
      await setLogo(hotel.id, await saveImage(hotel.id, png(w, h)), "t");
      await db().update(hotels).set({ content: { ...(await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0].content, brand: { ...(await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0].content.brand, color: "#0b7285" } } }).where(eq(hotels.id, hotel.id));
      const r = await applyStripeBranding((await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0], "t");
      expect(r).toMatchObject({ color: "#0b7285", logo: true, icon: expectIcon });
      expect(calls.files.map((c) => (c as { p: { purpose: string } }).p.purpose)).toEqual(expectIcon ? ["business_logo", "business_icon"] : ["business_logo"]);
      expect((calls.files[0] as { o: unknown }).o).toEqual({ stripeAccount: (await db().select().from(hotels).where(eq(hotels.id, hotel.id)))[0].stripeAccountId });
    }
  });
});
