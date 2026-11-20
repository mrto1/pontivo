import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { roleIn } from "../../src/auth/session";
import { areasOf, canAccess, isLimitedRole, landingFor, roleLabel } from "../../src/domain/roles";
import { changeMemberRole, deleteRole, listRoles, saveRole, setMemberRole, TeamError } from "../../src/services/team";
import { makeHotel } from "../helpers";

afterAll(closeDb);

const userId = async (email: string) => (await db().select().from(users).where(eq(users.email, email)))[0].id;

describe("Team: eigene Rollen", () => {
  it("Rolle anlegen, Person zuweisen: nur angehakte Seiten, Landing und Name stimmen", async () => {
    const h = await makeHotel();
    const r = await saveRole(h.hotel.id, null, { name: "Nachtportier", areas: ["frontdesk", "bookings", "gibt-es-nicht"] }, "t");
    expect(r.areas).toEqual(["frontdesk", "bookings"]); // unbekannte Seiten fallen weg
    const email = `n-${crypto.randomUUID()}@example.com`;
    await setMemberRole(h.hotel.id, email, `custom:${r.id}`, "t");
    const role = (await roleIn(await userId(email), h.hotel.id))!;
    expect(isLimitedRole(role)).toBe(true);
    expect(roleLabel(role)).toBe("Nachtportier");
    expect(canAccess(role, "staff", "frontdesk")).toBe(true);
    expect(canAccess(role, "staff", "layout")).toBe(true);
    expect(canAccess(role, "staff", "invoices")).toBe(false);
    expect(canAccess(role, "manager", "bookings")).toBe(false); // nie über «staff» hinaus
    expect(areasOf(role as never)).toContain("bookings");
    expect(landingFor(role as never)).toBe("frontdesk");
  });

  it("Änderung der Rolle gilt sofort; Löschen nur ohne Personen; Rollen sind je Betrieb getrennt", async () => {
    const a = await makeHotel(), b = await makeHotel();
    const r = await saveRole(a.hotel.id, null, { name: "Küche", areas: ["restaurant"] }, "t");
    const email = `k-${crypto.randomUUID()}@example.com`;
    await setMemberRole(a.hotel.id, email, `custom:${r.id}`, "t");
    await saveRole(a.hotel.id, r.id, { name: "Küche", areas: ["restaurant", "kasse"] }, "t");
    expect(canAccess((await roleIn(await userId(email), a.hotel.id))!, "staff", "kasse")).toBe(true);
    await expect(deleteRole(a.hotel.id, r.id, "t")).rejects.toThrow(TeamError);
    await expect(setMemberRole(b.hotel.id, email, `custom:${r.id}`, "t")).rejects.toThrow(TeamError); // fremde Rolle
    expect(await listRoles(b.hotel.id)).toHaveLength(0);
    await changeMemberRole(a.hotel.id, await userId(email), "housekeeping", "t");
    await deleteRole(a.hotel.id, r.id, "t");
    expect(await listRoles(a.hotel.id)).toHaveLength(0);
  });

  it("Prüfungen: Name, Seiten, reservierte Namen, doppelte Namen", async () => {
    const h = await makeHotel();
    await expect(saveRole(h.hotel.id, null, { name: "X", areas: ["bookings"] }, "t")).rejects.toThrow();
    await expect(saveRole(h.hotel.id, null, { name: "Leer", areas: [] }, "t")).rejects.toThrow(/Seite/);
    await expect(saveRole(h.hotel.id, null, { name: "Rezeption", areas: ["bookings"] }, "t")).rejects.toThrow(/reserviert/);
    await saveRole(h.hotel.id, null, { name: "Spät", areas: ["bookings"] }, "t");
    await expect(saveRole(h.hotel.id, null, { name: "spät", areas: ["bookings"] }, "t")).rejects.toThrow(/schon/);
  });
});
