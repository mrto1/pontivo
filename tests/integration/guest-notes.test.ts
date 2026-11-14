import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../../src/db/client";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { allTags, cleanTags, GuestNoteError, kartei, profileOf, saveProfile } from "../../src/services/guest-notes";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Gäste-Notizen (SPEC 17.2)", () => {
  it("Tags werden bereinigt", () => {
    expect(cleanTags(" Stammgast, VIP ;stammgast\n  Ruhig  ,,")).toEqual(["Stammgast", "VIP", "Ruhig"]);
    expect(cleanTags(Array.from({ length: 12 }, (_, i) => "t" + i))).toHaveLength(8);
    expect(cleanTags("x".repeat(40))[0]).toHaveLength(24);
  });

  it("speichern, suchen, leeren; getrennt pro Betrieb", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const checkin = inDays(20);
    const { booking } = await createDirectBooking(a.hotel, { roomTypeId: a.rooms[0].roomType.id, ratePlanId: a.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
    await saveProfile(a.hotel.id, guest.email.toUpperCase(), { note: "mag ruhiges Zimmer oben", tags: "Stammgast, VIP" }, "t");
    expect((await profileOf(a.hotel.id, guest.email))?.tags).toEqual(["Stammgast", "VIP"]);
    expect(await profileOf(b.hotel.id, guest.email)).toBeNull();
    let k = await kartei(a.hotel.id);
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ stays: 1, tags: ["Stammgast", "VIP"] });
    expect(await kartei(a.hotel.id, "ruhiges")).toHaveLength(1);
    expect(await kartei(a.hotel.id, "", "vip")).toHaveLength(1);
    expect(await kartei(a.hotel.id, "", "Allergie")).toHaveLength(0);
    expect(await kartei(b.hotel.id)).toHaveLength(0);
    expect(await allTags(a.hotel.id)).toEqual(["Stammgast", "VIP"]);
    await expect(saveProfile(a.hotel.id, guest.email, { note: "x".repeat(1001), tags: "" }, "t")).rejects.toThrow(GuestNoteError);
    await saveProfile(a.hotel.id, guest.email, { note: "", tags: "" }, "t");
    expect(await profileOf(a.hotel.id, guest.email)).toBeNull();
    k = await kartei(a.hotel.id);
    expect(k[0].tags).toEqual([]);
  });
});
