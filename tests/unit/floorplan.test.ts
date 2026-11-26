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
