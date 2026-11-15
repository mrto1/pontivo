import { describe, expect, it } from "vitest";
import { bookingIcs } from "../../src/domain/portal";

describe("Kalendereintrag zur Buchung (SPEC 19.13)", () => {
  const ics = bookingIcs({ reference: "PNT-ABC123", hotelName: "Hotel Alpenblick, Glarus", address: "Seestrasse 1, 8750 Glarus", checkin: "2026-12-24", checkout: "2026-12-27", checkinTime: "15:00", description: "Zeile 1\nZeile; 2", now: new Date("2026-11-15T10:00:00Z") });
  it("ganztägig von Anreise bis Abreise", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261224");
    expect(ics).toContain("DTEND;VALUE=DATE:20261227");
    expect(ics).toContain("UID:PNT-ABC123@pontivo");
    expect(ics).toContain("DTSTAMP:20261115T100000Z");
  });
  it("Sonderzeichen maskiert, CRLF, begrenzt", () => {
    expect(ics).toContain("SUMMARY:Hotel Alpenblick\\, Glarus");
    expect(ics).toContain("DESCRIPTION:Zeile 1\\nZeile\; 2");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
  it("lange Zeilen falten ohne Umlaute zu zerschneiden", () => {
    const long = bookingIcs({ reference: "R", hotelName: "Ä".repeat(100), address: "", checkin: "2026-12-24", checkout: "2026-12-25", checkinTime: "15:00", description: "x" });
    expect(long.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(long.replace(/\r\n /g, "")).toContain("SUMMARY:" + "Ä".repeat(100));
  });
});
