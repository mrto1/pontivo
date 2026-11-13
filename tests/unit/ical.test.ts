import { describe, expect, it } from "vitest";
import { buildIcal, nightRanges, parseIcal } from "../../src/domain/ical";
import { checkFeedUrl, isPrivateIp } from "../../src/lib/safe-fetch";

const cal = (...ev: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...ev, "END:VCALENDAR"].join("\r\n");
const vevent = (...l: string[]) => ["BEGIN:VEVENT", ...l, "END:VEVENT"].join("\r\n");

describe("iCal lesen", () => {
  it("DTEND ist exklusiv, Vergangenes und Storniertes zählt nicht", () => {
    const r = parseIcal(
      cal(
        vevent("DTSTART;VALUE=DATE:20270110", "DTEND;VALUE=DATE:20270113"),
        vevent("DTSTART;VALUE=DATE:20270201", "DTEND;VALUE=DATE:20270203", "STATUS:CANCELLED"),
        vevent("DTSTART;VALUE=DATE:20261201", "DTEND;VALUE=DATE:20261215"),
      ),
      "Europe/Zurich", "2026-12-10", "2028-01-01",
    );
    expect(r.ok && [...r.nights].sort()).toEqual(["2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13", "2026-12-14", "2027-01-10", "2027-01-11", "2027-01-12"]);
  });
  it("ohne DTEND eine Nacht; UTC-Zeitpunkte in Hoteldatum umgerechnet; gefaltete Zeilen", () => {
    const r = parseIcal(cal(vevent("DTSTART;VALUE=DATE:20270110"), vevent("DTSTART:20270120T233000Z", "DTEND:20270122T100000Z"), vevent("SUMMARY:Lang", " er Titel", "DTSTART;VALUE=DATE:20270301", "DTEND;VALUE=DATE:20270302")), "Europe/Zurich", "2027-01-01", "2028-01-01");
    expect(r.ok && [...r.nights].sort()).toEqual(["2027-01-10", "2027-01-21", "2027-03-01"]);
  });
  it("Horizont begrenzt; Fremdtext wird abgelehnt", () => {
    const r = parseIcal(cal(vevent("DTSTART;VALUE=DATE:20270101", "DTEND;VALUE=DATE:20270201")), "Europe/Zurich", "2027-01-01", "2027-01-05");
    expect(r.ok && r.nights.size).toBe(4);
    expect(parseIcal("<html>Login</html>", "Europe/Zurich", "2027-01-01", "2028-01-01").ok).toBe(false);
  });
});

describe("iCal schreiben", () => {
  it("Bereiche und Feed ohne Gästedaten", () => {
    expect(nightRanges(["2027-01-03", "2027-01-01", "2027-01-02", "2027-01-10"])).toEqual([{ from: "2027-01-01", to: "2027-01-04" }, { from: "2027-01-10", to: "2027-01-11" }]);
    const t = buildIcal("Hotel, Zimmer", "rt1", ["2027-01-01", "2027-01-02"], new Date("2026-11-13T10:00:00Z"));
    expect(t).toContain("DTSTART;VALUE=DATE:20270101");
    expect(t).toContain("DTEND;VALUE=DATE:20270103");
    expect(t).toContain("SUMMARY:Belegt");
    expect(t).toContain("X-WR-CALNAME:Hotel\\, Zimmer");
    expect(t.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // wieder lesbar
    const back = parseIcal(t, "Europe/Zurich", "2027-01-01", "2028-01-01");
    expect(back.ok && back.nights.size).toBe(2);
  });
});

describe("Adressen für den Import (SSRF)", () => {
  it("interne Adressen sind gesperrt", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("nur https, kein Login in der Adresse, kein Fremdport, keine IP-Adressen im Haus", () => {
    expect(checkFeedUrl("https://www.airbnb.ch/calendar/ical/1.ics?s=abc").hostname).toBe("www.airbnb.ch");
    for (const u of ["http://example.com/a.ics", "ftp://example.com", "https://user:pw@example.com/a", "https://example.com:8443/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a", "https://169.254.169.254/latest", "nicht-url"]) expect(() => checkFeedUrl(u), u).toThrow();
  });
});
