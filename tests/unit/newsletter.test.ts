import { describe, expect, it } from "vitest";
import { normEmail, select, validEmail, type Recipient } from "../../src/domain/newsletter";

const r = (o: Partial<Recipient>): Recipient => ({ email: "a@x.ch", language: "de", tags: [], stays: 1, lastStay: "2026-06-01", ...o });
describe("Newsletter-Auswahl (SPEC 19.12)", () => {
  const all = [r({ email: "a@x.ch" }), r({ email: "b@x.ch", language: "en", tags: ["stammgast"], stays: 3, lastStay: "2026-10-01" }), r({ email: "c@x.ch", lastStay: null, stays: 0 })];
  it("ohne Bedingung alle", () => expect(select(all, {})).toHaveLength(3));
  it("Sprache, Stichwort, Aufenthalt, Anzahl", () => {
    expect(select(all, { language: "en" }).map((x) => x.email)).toEqual(["b@x.ch"]);
    expect(select(all, { tag: "Stammgast" }).map((x) => x.email)).toEqual(["b@x.ch"]);
    expect(select(all, { stayedSince: "2026-09-01" }).map((x) => x.email)).toEqual(["b@x.ch"]);
    expect(select(all, { minStays: 2 }).map((x) => x.email)).toEqual(["b@x.ch"]);
    expect(select(all, { language: "de", minStays: 2 })).toHaveLength(0);
  });
  it("E-Mail normalisieren und prüfen", () => {
    expect(normEmail("  A@X.CH ")).toBe("a@x.ch");
    expect(validEmail("a@x.ch")).toBe(true);
    expect(validEmail("a@x")).toBe(false);
  });
});
