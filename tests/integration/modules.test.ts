import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog } from "../../src/db/schema";
import { isOn } from "../../src/domain/modules";
import { ModuleError, moduleOn, moduleRows, setModule } from "../../src/services/modules";
import { makeHotel } from "../helpers";

afterAll(closeDb);

describe("Module ein-/ausschalten (SPEC 16.1)", () => {
  it("Standard an, ausschalten wirkt nur für dieses Hotel, wieder einschalten, Audit", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    expect(await moduleOn(a.hotel.id, "frontdesk")).toBe(true);
    await setModule(a.hotel.id, "frontdesk", false, "user:test");
    expect(await moduleOn(a.hotel.id, "frontdesk")).toBe(false);
    expect(await moduleOn(b.hotel.id, "frontdesk")).toBe(true);
    expect(isOn(await moduleRows(a.hotel.id), "invoicing")).toBe(true);
    await setModule(a.hotel.id, "frontdesk", true, "user:test");
    expect(await moduleOn(a.hotel.id, "frontdesk")).toBe(true);
    const log = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, a.hotel.id), eq(auditLog.action, "module.frontdesk.off")));
    expect(log).toHaveLength(1);
  });
  it("unbekanntes Modul wird abgelehnt", async () => {
    const a = await makeHotel();
    await expect(setModule(a.hotel.id, "gibtsnicht", true, "x")).rejects.toBeInstanceOf(ModuleError);
  });
});
