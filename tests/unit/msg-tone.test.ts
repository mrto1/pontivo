import { describe, expect, it } from "vitest";
import { msgTone } from "../../src/domain/msg-tone";

describe("Ton von Rückmeldungen (SPEC 19.47)", () => {
  it("Fehler sind nie grün", () => {
    for (const t of ["Nicht möglich: Zimmer belegt.", "Zuerst das Stripe-Konto verbinden (Einstellungen → Zahlungsmethoden).", "Kein Zimmer frei.", "Das Passwort ist zu kurz.", "Der Code stimmt nicht, falsch eingegeben."]) expect(msgTone(t), t).toBe("error");
  });
  it("Erfolg bleibt grün", () => {
    for (const t of ["Zimmertyp gespeichert.", "Tarif angelegt.", "Eigentümer gespeichert.", "Gesendet."]) expect(msgTone(t), t).toBe("ok");
  });
});
