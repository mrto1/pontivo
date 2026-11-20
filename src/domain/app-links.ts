/**
 * Verknüpfung der Web-Adresse mit der nativen App myPontivo (SPEC 19.23): Android App Links (`assetlinks.json`) und iOS Universal Links
 * (`apple-app-site-association`). Die Kennungen kommen aus der Konfiguration; ohne sie bleiben die Dateien leer (kein Raten).
 */
export function assetLinks(pkg?: string, sha256?: string) {
  const fp = (sha256 ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!pkg || !fp.length) return [];
  return [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fp } }];
}

export function appleSiteAssociation(team?: string, bundle?: string) {
  if (!team || !bundle) return { applinks: { details: [] } };
  return { applinks: { details: [{ appIDs: [`${team}.${bundle}`], components: [{ "/": "/mypontivo/*" }] }] } };
}

/** Kennzeichnung der App-Hülle im User-Agent (in mobile/capacitor.config.ts gesetzt) */
export const APP_UA_MARK = "MyPontivoApp";
export const isNativeShell = (ua: string | null | undefined) => !!ua && ua.includes(APP_UA_MARK);
