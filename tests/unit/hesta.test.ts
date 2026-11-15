import { describe, expect, it } from "vitest";
import { byCountry, daysInMonth, hestaCsv, monthEnd, occupancy } from "../../src/domain/hesta";

describe("HESTA-Auswertung (SPEC 19.8)", () => {
  it("Monatsgrenzen", () => {
    expect(monthEnd("2026-12")).toBe("2027-01-01");
    expect(monthEnd("2026-02")).toBe("2026-03-01");
    expect(daysInMonth("2028-02")).toBe(29);
  });
  it("Ankünfte nur im Anreisemonat, Nächte nur innerhalb des Monats, über den Monatswechsel", () => {
    const rows = byCountry([
      { country: "de", arrival: "2026-10-30", departure: "2026-11-03" }, // 4 Nächte: 2 im Oktober, 3 im November? (30., 31. Okt; 1., 2. Nov)
      { country: "DE", arrival: "2026-11-05", departure: "2026-11-06" },
      { country: "CH", arrival: "2026-11-10", departure: "2026-11-12" },
      { country: null, arrival: "2026-11-29", departure: "2026-12-02" },
      { country: "FR", arrival: "2026-12-01", departure: "2026-12-03" }, // nicht im November
    ], "2026-11");
    const de = rows.find((r) => r.country === "DE")!;
    expect(de).toEqual({ country: "DE", arrivals: 1, nights: 2 + 1 });
    expect(rows.find((r) => r.country === "CH")).toEqual({ country: "CH", arrivals: 1, nights: 2 });
    expect(rows.find((r) => r.country === null)).toEqual({ country: null, arrivals: 1, nights: 2 });
    expect(rows.some((r) => r.country === "FR")).toBe(false);
    expect(rows[0].country).toBe("DE"); // meiste Logiernächte zuerst
  });
  it("Angebot und Auslastung", () => {
    const o = occupancy([{ roomCount: 3, maxOccupancy: 2 }, { roomCount: 2, maxOccupancy: 4 }], 75, "2026-11");
    expect(o).toMatchObject({ rooms: 5, beds: 14, days: 30, availableRoomNights: 150, roomOccupancyPct: 50 });
    expect(occupancy([], 0, "2026-11").roomOccupancyPct).toBe(0);
  });
  it("CSV mit Total und Anführungszeichen", () => {
    const csv = hestaCsv("2026-11", [{ country: "DE", arrivals: 2, nights: 5 }, { country: null, arrivals: 1, nights: 1 }], (c) => (c ? `Land "${c}"` : "Land unbekannt"));
    expect(csv).toContain('"2026-11";"Land ""DE""";"DE";"2";"5"');
    expect(csv).toContain('"Total";"";"3";"6"');
    expect(csv.startsWith("﻿")).toBe(true);
  });
});
