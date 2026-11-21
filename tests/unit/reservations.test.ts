import { describe, expect, it } from "vitest";
import { checkWindows, coversAt, depositFor, onlineSlots, refundable, slotTimes, suggestTable, tableFree, type ResSettings } from "../../src/domain/reservations";

const S: ResSettings = { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 6, capacity: 10, leadHours: 2, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true };
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
  it("Anzahlung ab Gruppengrösse, Rückerstattung bis Frist", () => {
    const d = { ...S, depositPerPersonRappen: 1000, depositFromParty: 4 };
    expect(depositFor(d, 3)).toBe(0);
    expect(depositFor(d, 4)).toBe(4000);
    expect(depositFor(S, 10)).toBe(0);
    const start = new Date("2026-12-01T18:00:00Z");
    expect(refundable(S, start, new Date("2026-11-30T17:59:00Z"))).toBe(true);
    expect(refundable(S, start, new Date("2026-11-30T18:01:00Z"))).toBe(false);
  });
  it("nicht bezahlte Reservierung hält nur kurz Plätze", () => {
    const fresh = { time: "18:00", party: 4, tableId: null, status: "pending", createdAt: new Date() };
    const stale = { ...fresh, createdAt: new Date(Date.now() - 40 * 60_000) };
    expect(coversAt([fresh], "18:00", 90)).toBe(4);
    expect(coversAt([stale], "18:00", 90)).toBe(0);
  });
  it("Tischvorschlag: kleinster freier Tisch mit genug Plätzen", () => {
    const tables = [{ id: "a", seats: 6 }, { id: "b", seats: 2 }, { id: "c", seats: 4 }];
    expect(suggestTable(tables, [], 2, "18:00", 90)).toBe("b");
    expect(suggestTable(tables, [], 3, "18:00", 90)).toBe("c");
    expect(suggestTable(tables, [{ time: "18:00", party: 2, tableId: "c", status: "confirmed" }], 3, "18:30", 90)).toBe("a");
    expect(suggestTable(tables, [], 7, "18:00", 90)).toBeNull();
  });
});
