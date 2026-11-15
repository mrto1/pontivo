import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelMembers, hotels, users } from "../../src/db/schema";
import { AccountExistsError, addHotelForUser, registerHost } from "../../src/services/onboarding";

afterAll(closeDb);

const base = { propertyType: "apartment" as const, name: "Chalet Doppel", contactName: "Ruth Keller", canton: "GR" as const, municipality: "Testdorf", acceptTerms: true as const };

describe("Registrierung mit bekannter E-Mail-Adresse", () => {
  it("legt kein zweites Konto und keinen zweiten Entwurf an; weitere Betriebe nur über addHotelForUser", async () => {
    const email = `doppel-${Date.now()}@example.ch`;
    await registerHost({ ...base, email });
    await expect(registerHost({ ...base, name: "Chalet Zwei", email })).rejects.toBeInstanceOf(AccountExistsError);
    await expect(registerHost({ ...base, name: "Chalet Drei", email: email.toUpperCase() })).rejects.toBeInstanceOf(AccountExistsError); // Gross-/Kleinschreibung
    const [u] = await db().select().from(users).where(eq(users.email, email));
    expect(await db().select().from(users).where(eq(users.email, email))).toHaveLength(1);
    expect(await db().select().from(hotelMembers).where(eq(hotelMembers.userId, u.id))).toHaveLength(1);
    expect(await db().select().from(hotels).where(eq(hotels.contactEmail, email))).toHaveLength(1);
    // angemeldet: weiterer Betrieb im selben Konto bleibt möglich
    const second = await addHotelForUser(u, { ...base, name: "Chalet Zwei" });
    expect(second.hotel.name).toBe("Chalet Zwei");
    expect(await db().select().from(hotelMembers).where(eq(hotelMembers.userId, u.id))).toHaveLength(2);
  });
});
