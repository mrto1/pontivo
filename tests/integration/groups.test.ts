import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, groupBlockDays, hotels, inventoryDays } from "../../src/db/schema";
import { addMember, changeBlock, createGroup, GroupError, groupDetail, listGroups, releaseDueGroups, releaseGroup, roomingCsv } from "../../src/services/groups";
import { createInvoiceDraft } from "../../src/services/invoicing";
import { cancelBooking } from "../../src/services/bookings";
import { addDays, todayIn } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function setup(roomCount = 5) {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  const arrival = inDays(30);
  const g = await createGroup(h.hotel, { name: "Firmenanlass Muster AG", company: "Muster AG", contactName: "Frau Muster", contactEmail: "muster@example.ch", street: "Bahnhofstr. 1", zip: "8001", city: "Zürich", arrival, departure: addDays(arrival, 3), releaseOn: addDays(arrival, -14) }, "t");
  return { ...h, g, arrival, rt: h.rooms[0] };
}
type S = Awaited<ReturnType<typeof setup>>;

const inv = async (s: S) => (await db().select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, s.rt.roomType.id), eq(inventoryDays.night, s.arrival))))[0];
const member = (s: S, last: string, extra: Record<string, unknown> = {}) => addMember(s.hotel, s.g.id, {
  roomTypeId: s.rt.roomType.id, ratePlanId: s.rt.plans[0].id, checkin: s.arrival, checkout: addDays(s.arrival, 3), adults: 1, children: 0, childrenAges: [],
  guest: { firstName: "Max", lastName: last, email: "", language: "de" }, notifyGuest: false, ...extra,
} as never, "t");

describe("Gruppen (SPEC 18.1)", () => {
  it("Block reserviert Zimmer im Bestand, Teilnehmer nehmen sie aus dem Block (Bestand bleibt), Freigabe gibt den Rest zurück", async () => {
    const s = await setup(5);
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 3, "t");
    expect((await inv(s)).booked).toBe(3);
    const b1 = await member(s, "Meier");
    expect(b1.groupId).toBe(s.g.id);
    expect(b1.status).toBe("confirmed");
    expect((await inv(s)).booked).toBe(3); // 1 Buchung + 2 Blockzimmer
    let d = await groupDetail(s.hotel.id, s.g.id);
    expect(d.rooming).toHaveLength(1);
    expect(d.blocks[0]).toMatchObject({ minLeft: 2, maxLeft: 2 });
    await member(s, "Huber");
    await member(s, "Keller");
    await expect(member(s, "Zuviel")).rejects.toThrow(GroupError); // Block aufgebraucht (die übrigen 2 Zimmer gehören nicht der Gruppe)
    expect((await inv(s)).booked).toBe(3);
    // Zusätzlich 1 Zimmer blocken, dann Freigabe: nur das freie Blockzimmer kehrt zurück
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 1, "t");
    expect((await inv(s)).booked).toBe(4);
    expect(await releaseGroup(s.hotel, s.g.id, "t")).toBe(3); // 1 freies Blockzimmer × 3 Nächte
    expect((await inv(s)).booked).toBe(3);
    expect((await db().select().from(groupBlockDays).where(eq(groupBlockDays.groupId, s.g.id))).every((r) => r.rooms === 0)).toBe(true);
    await expect(changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 1, "t")).rejects.toThrow(GroupError);
    expect(await releaseGroup(s.hotel, s.g.id, "t")).toBe(0);
    d = await groupDetail(s.hotel.id, s.g.id);
    expect(roomingCsv(d.rooming)).toContain("Keller");
  });

  it("Block nur, soweit frei; verkleinern nur um freie Blockzimmer; Teilnehmer nur innerhalb der Gruppenzeit", async () => {
    const s = await setup(2);
    await expect(changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 3, "t")).rejects.toThrow(/nicht mehr frei/);
    expect((await inv(s)).booked).toBe(0);
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 2, "t");
    await member(s, "A");
    await expect(changeBlock(s.hotel, s.g.id, s.rt.roomType.id, -2, "t")).rejects.toThrow(/Blockzimmer/);
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, -1, "t");
    expect((await inv(s)).booked).toBe(1);
    await expect(member(s, "B", { checkout: addDays(s.arrival, 5) })).rejects.toThrow(/innerhalb/);
  });

  it("Stornierung eines Teilnehmers gibt das Zimmer in den allgemeinen Bestand zurück", async () => {
    const s = await setup(3);
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 1, "t");
    const b = await member(s, "A");
    expect((await inv(s)).booked).toBe(1);
    await cancelBooking(b.id, { by: "hotel", hotelId: s.hotel.id, actor: "t" });
    expect((await inv(s)).booked).toBe(0);
  });

  it("Freigabefrist: Job gibt fällige Blöcke frei, nicht fällige bleiben; Mandantentrennung", async () => {
    const s = await setup(3);
    const o = await setup(3);
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 2, "t");
    expect(await releaseDueGroups(new Date())).toBe(0);
    const at = new Date(Date.now() + 25 * 86400000); // nach der Frist (Anreise − 14 Tage)
    expect(await releaseDueGroups(at)).toBeGreaterThanOrEqual(1);
    expect((await inv(s)).booked).toBe(0);
    expect((await listGroups(s.hotel.id)).find((g) => g.id === s.g.id)?.status).toBe("released");
    expect((await listGroups(o.hotel.id)).some((g) => g.id === s.g.id)).toBe(false);
    await expect(groupDetail(o.hotel.id, s.g.id)).rejects.toThrow(GroupError);
    await expect(changeBlock(o.hotel, s.g.id, o.rt.roomType.id, 1, "t")).rejects.toThrow(GroupError);
    expect(todayIn(s.hotel.timezone)).toBeTruthy();
  });

  it("Rechnung eines Teilnehmers geht an die Firma der Gruppe", async () => {
    const s = await setup(3);
    await changeBlock(s.hotel, s.g.id, s.rt.roomType.id, 1, "t");
    const b = await member(s, "A");
    const hotel = (await db().select().from(hotels).where(eq(hotels.id, s.hotel.id)))[0];
    const draft = await createInvoiceDraft(hotel, b.id, "t");
    expect(draft.recipient).toMatchObject({ company: "Muster AG", name: "Frau Muster", zip: "8001", city: "Zürich" });
    expect((await db().select().from(bookings).where(eq(bookings.id, b.id)))[0].groupId).toBe(s.g.id);
  });
});
