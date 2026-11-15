import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../../src/db/client";
import { doneTasks, setTask } from "../../src/services/guide";
import { addMember } from "../../src/services/settings";
import { db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { makeHotel } from "../helpers";

afterAll(closeDb);

describe("Checkliste «Erste Woche»", () => {
  it("abhaken, zurücknehmen, nur eigene Liste, je Betrieb getrennt", async () => {
    const a = await makeHotel(), b = await makeHotel();
    const email = `r-${crypto.randomUUID()}@example.com`;
    await addMember(a.hotel.id, email, "reception", "t");
    const [u] = await db().select().from(users).where(eq(users.email, email));
    expect(await setTask(a.hotel.id, u.id, "reception", "r_today", true)).toBe(true);
    expect(await setTask(a.hotel.id, u.id, "reception", "r_today", true)).toBe(true); // doppelt ist unschädlich
    expect(await setTask(a.hotel.id, u.id, "reception", "o_rooms", true)).toBe(false); // Aufgabe einer anderen Rolle
    expect([...(await doneTasks(a.hotel.id, u.id))]).toEqual(["r_today"]);
    expect((await doneTasks(b.hotel.id, u.id)).size).toBe(0);
    await setTask(a.hotel.id, u.id, "reception", "r_today", false);
    expect((await doneTasks(a.hotel.id, u.id)).size).toBe(0);
  });
});
