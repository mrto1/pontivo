import { describe, expect, it } from "vitest";
import { checkWindows, coversAt, onlineSlots, slotTimes, tableFree, type ResSettings } from "../../src/domain/reservations";

const S: ResSettings = { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 6, capacity: 10, leadHours: 2, horizonDays: 30 };
const now = { day: "2026-11-21", minutes: 16 * 60 };

describe("Reservierungen (SPEC 19.49 C)", () => {
  it("Zeitfenster prüfen", () => {
    expect(checkWindows([{ from: "11:30", to: "13:30" }, { from: "18:00", to: "21:00" }])).toBeNull();
    expect(checkWindows([])).toMatch(/Mindestens/);
    expect(checkWindows([{ from: "13:00", to: "12:00" }])).toMatch(/vor/);
    expect(checkWindows([{ from: "11:00", to: "14:00" }, { from: "13:00", to: "15:00" }])).toMatch(/überschneiden/);
    expect(checkWindows([{ from: "25:00", to: "26:00" }])).toMatch(/ungültig/);
  });
  it("Beginnzeiten im 30-Minuten-Raster inklusive Fensterende", () => {
    expect(slotTimes([{ from: "18:00", to: "20:00" }])).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00"]);
  });
  it("Gäste überlappender Reservierungen, Storno zählt nicht", () => {
    const ex = [{ time: "18:00", party: 4, tableId: null, status: "confirmed" }, { time: "19:00", party: 3, tableId: null, status: "cancelled" }, { time: "19:30", party: 2, tableId: null, status: "seated" }];
    expect(coversAt(ex, "18:00", 90)).toBe(4); // 19:30 beginnt erst nach 19:30 = Ende 18:00+90
    expect(coversAt(ex, "19:00", 90)).toBe(6);
    expect(coversAt(ex, "20:00", 90)).toBe(2);
  });
  it("Tisch frei prüfen", () => {
    const ex = [{ id: "a", time: "18:00", party: 2, tableId: "t1", status: "confirmed" }];
    expect(tableFree(ex, "t1", "19:00", 90)).toBe(false);
    expect(tableFree(ex, "t1", "19:30", 90)).toBe(true);
    expect(tableFree(ex, "t2", "18:00", 90)).toBe(true);
    expect(tableFree(ex, "t1", "18:00", 90, "a")).toBe(true);
  });
  it("online: Kapazität, Vorlauf, Grösse, Horizont", () => {
    const ex = [{ time: "18:00", party: 8, tableId: null, status: "confirmed" }];
    const slots = onlineSlots(S, "2026-11-22", 4, ex, now, 1);
    expect(slots.find((x) => x.time === "18:00")!.ok).toBe(false); // 8 + 4 > 10
    expect(slots.find((x) => x.time === "19:30")!.ok).toBe(true);
    expect(onlineSlots(S, "2026-11-21", 2, [], now, 0).filter((x) => x.ok).map((x) => x.time)).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00"]); // Vorlauf 2 h ab 16:00 = 18:00 frühestens
    expect(onlineSlots(S, "2026-11-21", 2, [], { day: "2026-11-21", minutes: 17 * 60 }, 0).filter((x) => x.ok).map((x) => x.time)).toEqual(["19:00", "19:30", "20:00"]);
    expect(onlineSlots(S, "2026-11-22", 7, [], now, 1)).toEqual([]);
    expect(onlineSlots(S, "2027-01-01", 2, [], now, 41)).toEqual([]);
    expect(onlineSlots({ ...S, onlineEnabled: false }, "2026-11-22", 2, [], now, 1)).toEqual([]);
  });
});
