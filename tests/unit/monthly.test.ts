import { describe, expect, it } from "vitest";
import { changePct, monthLabelDe, summarize, worthSending } from "../../src/domain/monthly";

const z = { bookings: 0, nights: 0, revenueRappen: 0, feeRappen: 0 };

describe("Monatsmail: Logik", () => {
  it("Ersparnis = 15 % Portalprovision minus Plattformgebühr, nie negativ", () => {
    expect(summarize("2026-10", { bookings: 5, nights: 12, revenueRappen: 400000, feeRappen: 7600 }, z, 3).savedRappen).toBe(60000 - 7600);
    expect(summarize("2026-10", { bookings: 1, nights: 1, revenueRappen: 1000, feeRappen: 5000 }, z, 0).savedRappen).toBe(0);
  });
  it("nur senden, wenn es etwas zu berichten gibt", () => {
    expect(worthSending(summarize("2026-10", z, z, 5))).toBe(false);
    expect(worthSending(summarize("2026-10", z, { ...z, bookings: 2 }, 0))).toBe(true);
    expect(worthSending(summarize("2026-10", { ...z, bookings: 1 }, z, 0))).toBe(true);
  });
  it("Veränderung und Monatsname", () => {
    expect(changePct(6, 4)).toBe(50);
    expect(changePct(2, 4)).toBe(-50);
    expect(changePct(3, 0)).toBeNull();
    expect(monthLabelDe("2026-10")).toBe("Oktober 2026");
    expect(monthLabelDe("2027-03")).toBe("März 2027");
  });
});
