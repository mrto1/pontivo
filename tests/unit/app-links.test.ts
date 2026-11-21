import { describe, expect, it } from "vitest";
import { appleSiteAssociation, assetLinks, isNativeShell } from "../../src/domain/app-links";

describe("App-Links (SPEC 19.23)", () => {
  it("ohne Kennungen bleiben die Dateien leer (nichts geraten)", () => {
    expect(assetLinks()).toEqual([]);
    expect(assetLinks("ch.x.y", "")).toEqual([]);
    expect(appleSiteAssociation().applinks.details).toEqual([]);
  });
  it("mit Kennungen: Android Fingerabdrücke und iOS appID", () => {
    const a = assetLinks("ch.pontivo.app", "aa:bb, cc:dd");
    expect(a[0].target).toMatchObject({ namespace: "android_app", package_name: "ch.pontivo.app", sha256_cert_fingerprints: ["AA:BB", "CC:DD"] });
    expect(appleSiteAssociation("TEAM123", "ch.pontivo.app").applinks.details[0]).toMatchObject({ appIDs: ["TEAM123.ch.pontivo.app"] });
  });
  it("App-Hülle am User-Agent erkennen", () => {
    expect(isNativeShell("Mozilla/5.0 MyPontivoApp/1.0")).toBe(true);
    expect(isNativeShell("Mozilla/5.0 Chrome")).toBe(false);
    expect(isNativeShell(null)).toBe(false);
  });
});
