import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels } from "../../src/db/schema";
import { setGuestInfo } from "../../src/services/onboarding";
import { makeHotel } from "../helpers";

afterAll(closeDb);

describe("Aufenthaltsinfos fürs Gästeportal (SPEC 19.13)", () => {
  it("speichert je Sprache, kürzt Leerraum, lässt andere Inhalte unberührt", async () => {
    const h = await makeHotel();
    await setGuestInfo(h.hotel, { de: "  Frühstück 7–10 Uhr  ", en: "" }, "t");
    const [row] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    expect(row.content.guestInfo?.de).toBe("Frühstück 7–10 Uhr");
    expect(row.content.guestInfo?.en).toBeUndefined();
    expect(row.content.arrivalInfo).toEqual(h.hotel.content.arrivalInfo);
  });
});
