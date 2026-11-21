import { describe, expect, it } from "vitest";
import { dayNotices } from "../../src/domain/day-notices";

const base = { base: "/mypontivo/h", manages: true, channexEnabled: true, channexFailed: 0, roomTypesWithoutPhoto: [], openGuestRequests: 0, openInquiries: 0, inboxVisible: true };

describe("Hinweise auf «Tag» (SPEC 19.42)", () => {
  it("ohne Anlass keine Hinweise", () => expect(dayNotices(base)).toEqual([]));
  it("jeder Hinweis führt direkt zur passenden Seite", () => {
    const n = dayNotices({ ...base, channexFailed: 3, roomTypesWithoutPhoto: [{ id: "rt1", name: "Doppelzimmer" }], openGuestRequests: 2, openInquiries: 1 });
    const href = (k: string) => n.find((x) => x.key === k)?.href;
    expect(href("channex")).toBe("/mypontivo/h/channex");
    expect(href("photos")).toBe("/mypontivo/h/rooms?rt=rt1&tab=fotos");
    expect(href("wishes")).toBe("/mypontivo/h/inbox?quelle=wuensche");
    expect(href("inquiries")).toBe("/mypontivo/h/inbox?quelle=web");
    expect(n.find((x) => x.key === "channex")!.tone).toBe("warn");
  });
  it("Mitarbeitende sehen keine Einstellungs-Hinweise, nur den Posteingang", () => {
    const n = dayNotices({ ...base, manages: false, channexFailed: 3, roomTypesWithoutPhoto: [{ id: "a", name: "A" }], openGuestRequests: 1 });
    expect(n.map((x) => x.key)).toEqual(["wishes"]);
    expect(dayNotices({ ...base, manages: false, inboxVisible: false, openGuestRequests: 5 })).toEqual([]);
  });
  it("Kanal-Hinweis nur bei aktivem Abgleich; viele Zimmertypen werden gekürzt", () => {
    expect(dayNotices({ ...base, channexEnabled: false, channexFailed: 2 })).toEqual([]);
    expect(dayNotices({ ...base, roomTypesWithoutPhoto: ["A", "B", "C", "D"].map((n) => ({ id: n, name: n })) })[0].text).toContain("«A», «B», «C» …");
  });
});
