import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog, users } from "../../src/db/schema";
import { addPlatformAdmin, removePlatformAdmin } from "../../src/services/platform-admin";
import { createUser } from "../../src/services/setup";
import { uid } from "../helpers";

afterAll(closeDb);
const isAdmin = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0].isPlatformAdmin;

describe("mehrere Plattform-Admins", () => {
  it("neue und bestehende Konten hinzufügen, Doppelte und ungültige E-Mail abweisen", async () => {
    const e1 = `neu-${uid()}@example.ch`;
    const a = await addPlatformAdmin(`  ${e1.toUpperCase()} `, "Neu Person", "t");
    expect(a).toMatchObject({ email: e1, created: true });
    expect(await isAdmin(a.id)).toBe(true);
    await expect(addPlatformAdmin(e1, null, "t")).rejects.toThrow(/schon Plattform-Admin/);
    await expect(addPlatformAdmin("kaputt", null, "t")).rejects.toThrow(/ungültig/);
    // bestehendes Konto eines Hotels wird befördert
    const existing = await createUser(`gast-${uid()}@example.ch`, { name: "Hotelier" });
    expect(await isAdmin(existing.id)).toBe(false);
    expect(await addPlatformAdmin(existing.email, null, "t")).toMatchObject({ id: existing.id, created: false });
    expect(await isAdmin(existing.id)).toBe(true);
    const logs = await db().select().from(auditLog).where(eq(auditLog.entityId, a.id));
    expect(logs.map((l) => l.action)).toContain("platform_admin.added");
  });

  it("Recht entziehen: nicht sich selbst, nicht den letzten Admin, Konto bleibt", async () => {
    const a = await addPlatformAdmin(`a-${uid()}@example.ch`, null, "t");
    const b = await addPlatformAdmin(`b-${uid()}@example.ch`, null, "t");
    await expect(removePlatformAdmin(a.id, a.id, "t")).rejects.toThrow(/selbst/);
    await removePlatformAdmin(b.id, a.id, "t");
    expect(await isAdmin(b.id)).toBe(false);
    expect((await db().select().from(users).where(eq(users.id, b.id))).length).toBe(1);
    await expect(removePlatformAdmin(b.id, a.id, "t")).rejects.toThrow(/kein Plattform-Admin/);
  });
});
