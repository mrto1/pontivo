import { describe, it, expect } from "vitest";
import { calendarCsv } from "@/src/domain/calendar-export";

describe("calendarCsv", () => {
  const d = {
    roomTypes: [{ id: "r1", name: "Doppel; Zimmer" }],
    ratePlans: [{ id: "p1", roomTypeId: "r1", name: "Flexibel" }],
    inventory: [{ roomTypeId: "r1", night: "2026-11-20", total: 4, booked: 1, blocked: 1, externalBlocked: 0 }],
    rates: [{ ratePlanId: "p1", night: "2026-11-20", priceRappen: 15050, minStayArrival: 2, closedToArrival: false, closedToDeparture: true, stopSell: false }],
  };
  it("eine Zeile je Tag und Rateplan, BOM, Semikolon", () => {
    const c = calendarCsv(d, "2026-11-20", "2026-11-21");
    const l = c.split("\r\n");
    expect(c.startsWith("﻿Datum;")).toBe(true);
    expect(l[1]).toBe('2026-11-20;Fr;"Doppel; Zimmer";4;1;1;0;2;Flexibel;150.50;2;nein;ja;nein');
    expect(l[2]).toBe('2026-11-21;Sa;"Doppel; Zimmer";;;;;;Flexibel;;;;;');
  });
});

import { exportLimited } from "@/src/lib/export-limit";
describe("exportLimited", () => {
  it("sperrt nach 20 Exporten in 10 Minuten", async () => {
    const u = `u-${Math.random()}`;
    for (let i = 0; i < 20; i++) expect(await exportLimited(u, "h1")).toBeNull();
    const r = await exportLimited(u, "h1");
    expect(r?.status).toBe(429);
    expect(r?.headers.get("retry-after")).toBe("600");
  });
});
