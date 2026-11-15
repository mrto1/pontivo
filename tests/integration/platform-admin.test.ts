import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { auditLog, hotelMembers, hotels, userPasskeys, userTotp, users } from "../../src/db/schema";
import { registerHost } from "../../src/services/onboarding";
import { addMember } from "../../src/services/settings";
import { beginTotp, confirmTotp, setEmailLoginDisabled } from "../../src/services/mfa";
import { totpCode, totpStep } from "../../src/domain/totp";
import { deleteHotelCascade, deleteUserAccount, platformOverview, resetUserSecurity, soleHotelsOf } from "../../src/services/platform-admin";

afterAll(closeDb);
const uid = () => Math.random().toString(36).slice(2, 9);
const mk = async () => {
  const email = `pa-${uid()}@example.ch`;
  const { hotel } = await registerHost({ propertyType: "apartment", name: `Chalet ${uid()}`, contactName: "R K", email, canton: "GR", municipality: `Dorf-${uid()}`, acceptTerms: true } as never);
  const [u] = await db().select().from(users).where(eq(users.email, email));
  return { hotel, user: u };
};

describe("Plattform-Verwaltung", () => {
  it("Übersicht zeigt Betrieb, Mitglieder und Sicherheit", async () => {
    const { hotel, user } = await mk();
    const o = await platformOverview();
    const h = o.hotels.find((x) => x.id === hotel.id)!;
    expect(h.members).toMatchObject([{ email: user.email, role: "owner" }]);
    expect(o.users.find((x) => x.id === user.id)).toMatchObject({ passkeys: 0, totp: false, emailLoginDisabled: false });
  });

  it("Betrieb löschen: alle Daten weg, Benutzer bleibt, Protokolleintrag ohne Betriebsbezug", async () => {
    const { hotel, user } = await mk();
    const counts = await deleteHotelCascade(hotel.id, "user:test");
    expect(counts.get("hotels")).toBe(1);
    expect(await db().select().from(hotels).where(eq(hotels.id, hotel.id))).toHaveLength(0);
    expect(await db().select().from(hotelMembers).where(eq(hotelMembers.hotelId, hotel.id))).toHaveLength(0);
    expect(await db().select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    const log = (await db().select().from(auditLog).where(eq(auditLog.entityId, hotel.id))).find((l) => l.action === "hotel.deleted");
    expect(log).toMatchObject({ hotelId: null, actor: "user:test" });
    await expect(deleteHotelCascade(hotel.id, "user:test")).rejects.toThrow();
  });

  it("Benutzer löschen: samt Passkeys und 2FA; Betrieb bleibt; Plattform-Admin geschützt", async () => {
    const { hotel, user } = await mk();
    await db().insert(userPasskeys).values({ userId: user.id, credentialId: `c-${user.id}`, publicKey: "AAAA", name: "x" });
    const b = await beginTotp(user.id);
    await confirmTotp(user.id, totpCode(b.secret, totpStep(Date.now())));
    expect((await soleHotelsOf(user.id)).map((h) => h.id)).toEqual([hotel.id]);
    await deleteUserAccount(user.id, "user:test");
    expect(await db().select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    expect(await db().select().from(userPasskeys).where(eq(userPasskeys.userId, user.id))).toHaveLength(0);
    expect(await db().select().from(userTotp).where(eq(userTotp.userId, user.id))).toHaveLength(0);
    expect(await db().select().from(hotels).where(eq(hotels.id, hotel.id))).toHaveLength(1);
    const [adm] = await db().insert(users).values({ email: `adm-${uid()}@example.ch`, isPlatformAdmin: true }).returning();
    await expect(deleteUserAccount(adm.id, "user:test")).rejects.toThrow(/Plattform-Admin/);
  });

  it("Sicherheit zurücksetzen entfernt Passkeys, 2FA und «Nur Passkey»", async () => {
    const { user } = await mk();
    for (const n of [1, 2]) await db().insert(userPasskeys).values({ userId: user.id, credentialId: `c${n}-${user.id}`, publicKey: "AAAA", name: `P${n}` });
    await setEmailLoginDisabled(user.id, true);
    const b = await beginTotp(user.id);
    await confirmTotp(user.id, totpCode(b.secret, totpStep(Date.now())));
    await resetUserSecurity(user.id, "user:test");
    const o = (await platformOverview()).users.find((x) => x.id === user.id)!;
    expect(o).toMatchObject({ passkeys: 0, totp: false, emailLoginDisabled: false });
  });

  it("Mitglied hinzufügen: zweiter Benutzer im selben Betrieb; Betrieb bleibt beim Löschen des einen Benutzers", async () => {
    const { hotel, user } = await mk();
    const mail = `team-${uid()}@example.ch`;
    await addMember(hotel.id, mail, "reception", "user:test");
    const h = (await platformOverview()).hotels.find((x) => x.id === hotel.id)!;
    expect(h.members.map((m) => m.role).sort()).toEqual(["owner", "reception"]);
    const [t] = await db().select().from(users).where(eq(users.email, mail));
    await deleteUserAccount(t.id, "user:test");
    expect((await soleHotelsOf(user.id)).map((x) => x.id)).toEqual([hotel.id]);
  });
});
