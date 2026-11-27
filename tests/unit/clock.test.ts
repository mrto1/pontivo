import { afterEach, describe, expect, it, vi } from "vitest";
import { testClockAllowed } from "../../src/lib/clock";

describe("Test-Uhr", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("nur mit E2E_CLOCK=1 und nie in Produktion", () => {
    vi.stubEnv("E2E_CLOCK", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(testClockAllowed()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(testClockAllowed()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_CLOCK", "");
    expect(testClockAllowed()).toBe(false);
  });
});
