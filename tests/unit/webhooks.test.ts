import { describe, expect, it } from "vitest";
import { ipAllowed, isPrivateIp, MAX_ATTEMPTS, nextAttemptAt, originOf, sign, urlProblem, verifySignature } from "../../src/domain/webhooks";

describe("Webhooks (SPEC 19.22)", () => {
  it("Signatur: gültig, falscher Inhalt, alter Zeitstempel, falsches Geheimnis", () => {
    const h = sign("whsec_x", '{"a":1}', 1_000_000);
    expect(verifySignature("whsec_x", '{"a":1}', h, 1_000_100)).toBe(true);
    expect(verifySignature("whsec_x", '{"a":2}', h, 1_000_100)).toBe(false);
    expect(verifySignature("whsec_x", '{"a":1}', h, 1_001_000)).toBe(false);
    expect(verifySignature("whsec_y", '{"a":1}', h, 1_000_100)).toBe(false);
    expect(verifySignature("whsec_x", '{"a":1}', "t=1,v1=zz", 1)).toBe(false);
  });
  it("Wiederholung: Wartezeiten, danach Schluss", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(nextAttemptAt(1, now)!.getTime() - now.getTime()).toBe(60_000);
    expect(nextAttemptAt(3, now)!.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(nextAttemptAt(MAX_ATTEMPTS, now)).toBeNull();
  });
  it("SSRF: private, lokale und reservierte Adressen sind gesperrt", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("Adressen: nur https, keine IP, kein localhost, keine Zugangsdaten", () => {
    expect(urlProblem("https://www.hotel.ch/hook")).toBeNull();
    for (const u of ["http://www.hotel.ch/h", "https://localhost/h", "https://10.0.0.1/h", "https://[::1]/h", "https://user:pw@hotel.ch/h", "https://intern/h", "https://x.internal/h", "ftp://hotel.ch", "nonsense"]) expect(urlProblem(u), u).not.toBeNull();
  });
  it("Rückkehr-Ursprung und IP-Liste", () => {
    expect(originOf("https://www.hotel.ch/danke?x=1")).toBe("https://www.hotel.ch");
    expect(originOf("http://www.hotel.ch")).toBeNull();
    expect(ipAllowed([], "1.2.3.4")).toBe(true);
    expect(ipAllowed(["1.2.3.4"], "1.2.3.4")).toBe(true);
    expect(ipAllowed(["1.2.3.4"], "5.6.7.8")).toBe(false);
  });
});
