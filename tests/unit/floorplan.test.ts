import { describe, expect, it } from "vitest";
import { chairLayout, clampPlan, tableState } from "../../src/domain/floorplan";

describe("tableState", () => {
  const res = [
    { tableId: "t1", time: "18:00", status: "confirmed" as const },
    { tableId: "t2", time: "18:00", status: "seated" as const },
    { tableId: "t3", time: "18:00", status: "cancelled" as const },
  ];
  it("frei ausserhalb des Fensters", () => {
    expect(tableState("t1", res, "17:59", 90)).toBe("free");
    expect(tableState("t1", res, "19:30", 90)).toBe("free");
  });
  it("reserviert im Fenster", () => expect(tableState("t1", res, "18:30", 90)).toBe("reserved"));
  it("besetzt wenn Gast sitzt", () => expect(tableState("t2", res, "18:00", 90)).toBe("seated"));
  it("stornierte zählen nicht", () => expect(tableState("t3", res, "18:30", 90)).toBe("free"));
});

describe("chairLayout", () => {
  it("liefert so viele Stühle wie Plätze", () => {
    for (const shape of ["square", "round", "rect"] as const) {
      for (const n of [1, 2, 4, 5, 8, 12, 20]) expect(chairLayout(n, shape)).toHaveLength(n);
    }
  });
  it("eckig: Hälfte oben, Rest unten", () => {
    const c = chairLayout(5, "square");
    expect(c.filter((x) => x.y < 0)).toHaveLength(3);
    expect(c.filter((x) => x.y > 0)).toHaveLength(2);
  });
});

describe("clampPlan", () => {
  it("begrenzt", () => {
    expect(clampPlan(-5)).toBe(0);
    expect(clampPlan(1200)).toBe(1000);
    expect(clampPlan(499.6)).toBe(500);
  });
});

import { initials, tableView } from "../../src/domain/floorplan";
describe("initials und tableView", () => {
  it("Initialen", () => {
    expect(initials("Anna Muster")).toBe("AM");
    expect(initials("Beat")).toBe("BE");
    expect(initials("  ")).toBe("?");
  });
  const list = [
    { id: "a", tableId: "t1", time: "18:00", status: "confirmed" as const, name: "A", party: 2 },
    { id: "b", tableId: "t1", time: "20:00", status: "confirmed" as const, name: "B", party: 2 },
  ];
  it("laufende und nächste Reservierung", () => {
    const v = tableView("t1", list, "18:30", 90);
    expect(v).toMatchObject({ state: "reserved", endCur: "19:30" });
    expect(v.next?.id).toBe("b");
    expect(v.soon).toBe(false);
    expect(tableView("t1", list, "19:45", 90).soon).toBe(true);
    expect(tableView("t1", list, "10:00", 90).state).toBe("free");
  });
});

import { suggestCombination, tableFree } from "../../src/domain/reservations";
describe("Tische zusammenlegen (SPEC 19.58)", () => {
  const tables = [
    { id: "a", seats: 4, areaId: "r1", planX: 100, planY: 100 },
    { id: "b", seats: 4, areaId: "r1", planX: 200, planY: 100 },
    { id: "c", seats: 4, areaId: "r1", planX: 900, planY: 900 },
    { id: "t", seats: 6, areaId: "r2", planX: 100, planY: 100 },
  ];
  it("nimmt den nächsten Tisch im selben Raum", () => {
    const c = suggestCombination(tables, [], 7, "18:00", 90)!;
    expect(c).toHaveLength(2);
    expect(new Set(c)).toEqual(new Set(["a", "b"]));
  });
  it("null, wenn die Plätze nicht reichen; Räume werden nicht gemischt", () => {
    expect(suggestCombination(tables, [], 20, "18:00", 90)).toBeNull();
    expect(suggestCombination([{ id: "x", seats: 2, areaId: "r1" }, { id: "y", seats: 2, areaId: "r2" }], [], 4, "18:00", 90)).toBeNull();
  });
  it("belegte Tische (auch als Zusatztisch) zählen nicht", () => {
    const ex = [{ time: "18:00", party: 6, tableId: "a", extraTableIds: ["b"], status: "confirmed" }];
    expect(tableFree(ex, "b", "18:30", 90)).toBe(false);
    expect(suggestCombination(tables, ex, 7, "18:00", 90)).toBeNull();
  });
});

import { onlineSlots, onlineTableAvailable, onlineTables, type ResSettings } from "../../src/domain/reservations";
describe("Online steuern und Küchentakt (SPEC 19.59)", () => {
  const s: ResSettings = { onlineEnabled: true, windows: [{ from: "18:00", to: "19:00" }], durationMin: 90, maxParty: 10, capacity: 100, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, slotMaxGuests: 6 };
  it("Küchentakt begrenzt Gäste je Beginnzeit", () => {
    const ex = [{ time: "18:00", party: 4, tableId: null, status: "confirmed" }];
    const slots = onlineSlots(s, "2026-12-01", 3, ex, { day: "2026-11-01", minutes: 0 }, 30);
    expect(slots.find((x) => x.time === "18:00")!.ok).toBe(false); // 4 + 3 > 6
    expect(slots.find((x) => x.time === "18:30")!.ok).toBe(true);
    expect(onlineSlots({ ...s, slotMaxGuests: 0 }, "2026-12-01", 3, ex, { day: "2026-11-01", minutes: 0 }, 30)[0].ok).toBe(true);
  });
  it("nur online buchbare Tische und Räume", () => {
    const all = [{ id: "a", seats: 4, online: true, areaId: "r1" }, { id: "b", seats: 4, online: false, areaId: "r1" }, { id: "c", seats: 4, online: true, areaId: "r2" }];
    expect(onlineTables(all, new Set(["r2"])).map((t) => t.id)).toEqual(["a"]);
    expect(onlineTableAvailable([{ id: "a", seats: 4 }], [{ time: "18:00", party: 2, tableId: "a", status: "confirmed" }], 2, "18:30", 90, false)).toBe(false);
    expect(onlineTableAvailable([{ id: "a", seats: 4 }], [], 2, "18:30", 90, false)).toBe(true);
  });
});
