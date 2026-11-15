import { describe, expect, it } from "vitest";
import { accountPrefill } from "../../src/integrations/stripe/onboarding";

const base = { propertyType: "hotel" as const, legalName: "Alpenrose AG", name: "Hotel Alpenrose", addressLine: " Dorfstrasse 1 ", postalCode: "9000", city: "St. Gallen", contactEmail: "info@alpenrose.ch", contactPhone: "+41 71 000 00 00", primaryDomain: "alpenrose.ch" };

describe("Stripe-Konto vorausfüllen", () => {
  it("Hotel (Firma): Firmenname, Adresse, Telefon und Support-Angaben", () => {
    const p = accountPrefill(base);
    expect(p.businessDetails).toEqual({ registered_name: "Alpenrose AG", address: { country: "ch", line1: "Dorfstrasse 1", postal_code: "9000", city: "St. Gallen" }, phone: "+41 71 000 00 00" });
    expect(p.support).toEqual({ email: "info@alpenrose.ch", phone: "+41 71 000 00 00", address: { country: "ch", line1: "Dorfstrasse 1", postal_code: "9000", city: "St. Gallen" }, url: "https://alpenrose.ch" });
  });
  it("Privatperson (z. B. Ferienwohnung): keine Firmenangaben, nur Support", () => {
    const p = accountPrefill({ ...base, propertyType: "apartment" });
    expect(p.businessDetails).toBeUndefined();
    expect(p.support.email).toBe("info@alpenrose.ch");
  });
  it("leere Angaben werden weggelassen, Adresse nur vollständig", () => {
    const p = accountPrefill({ ...base, legalName: null, contactPhone: " ", postalCode: null, primaryDomain: null });
    expect(p.businessDetails).toBeUndefined();
    expect(p.support).toEqual({ email: "info@alpenrose.ch" });
  });
});
