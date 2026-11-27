import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminHref, userErrorText } from "../../src/lib/hotel-action";
import { UserError } from "../../src/domain/errors";
import { PosError } from "../../src/services/pos";

describe("hotelAction-Hilfen", () => {
  it("zeigt Fach- und Eingabefehler, aber keine Programmfehler", () => {
    expect(userErrorText(new UserError("Bitte einen Namen angeben."))).toBe("Bitte einen Namen angeben.");
    expect(userErrorText(new PosError("Preis fehlt"))).toBe("Preis fehlt");
    const zod = z.object({ n: z.string().min(2, "Name zu kurz") }).safeParse({ n: "a" });
    expect(userErrorText(zod.error)).toBe("Name zu kurz");
    expect(userErrorText(new TypeError("x is undefined"))).toBeNull();
    expect(userErrorText(new Error("connection refused"))).toBeNull();
  });
  it("baut Admin-Adressen mit Parametern und Anker", () => {
    expect(adminHref("h1", "direktbuchung", { msg: "Gespeichert." }, "#vorteile")).toBe("/admin/h1/direktbuchung?msg=Gespeichert.#vorteile");
    expect(adminHref("h1", "", { e: "", msg: "ok" })).toBe("/admin/h1?msg=ok");
    expect(adminHref("h1", "/team", { rolle: "std:frontdesk" })).toBe("/admin/h1/team?rolle=std%3Afrontdesk");
  });
  it("Fehlerklassen haben ihren Namen", () => {
    expect(new PosError("x").name).toBe("PosError");
    expect(new PosError("x")).toBeInstanceOf(UserError);
  });
});
