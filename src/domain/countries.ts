/** ISO 3166-1 alpha-2 (plus XK Kosovo), Namen über Intl.DisplayNames in der Sprache des Gastes */
const CODES =
  "ADAEAFAGAIALAMAOAQARASATAUAWAXAZBABBBDBEBFBGBHBIBJBLBMBNBOBQBRBSBTBVBWBYBZCACCCDCFCGCHCICKCLCMCNCOCRCUCVCWCXCYCZDEDJDKDMDODZECEEEGEHERESETFIFJFKFMFOFRGAGBGDGEGFGGGHGIGLGMGNGPGQGRGSGTGUGWGYHKHMHNHRHTHUIDIEILIMINIOIQIRISITJEJMJOJPKEKGKHKIKMKNKPKRKWKYKZLALBLCLILKLRLSLTLULVLYMAMCMDMEMFMGMHMKMLMMMNMOMPMQMRMSMTMUMVMWMXMYMZNANCNENFNGNINLNONPNRNUNZOMPAPEPFPGPHPKPLPMPNPRPSPTPWPYQARERORSRURWSASBSCSDSESGSHSISJSKSLSMSNSOSRSSSTSVSXSYSZTCTDTFTGTHTJTKTLTMTNTOTRTTTVTWTZUAUGUMUSUYUZVAVCVEVGVIVNVUWFWSXKYEYTZAZMZW";

export const COUNTRY_CODES: string[] = CODES.match(/../g)!;
const SET = new Set(COUNTRY_CODES);
export const isCountry = (c: string) => SET.has(c);

/** Häufige Länder zuerst, dann alphabetisch in der Sprache */
const TOP = ["CH", "DE", "AT", "IT", "FR", "LI", "NL"];

export function countryOptions(locale: string): { code: string; name: string }[] {
  const dn = new Intl.DisplayNames([locale], { type: "region" });
  const name = (c: string) => dn.of(c) ?? c;
  const rest = COUNTRY_CODES.filter((c) => !TOP.includes(c)).map((code) => ({ code, name: name(code) })).sort((a, b) => a.name.localeCompare(b.name, locale));
  return [...TOP.map((code) => ({ code, name: name(code) })), ...rest];
}

export const countryName = (c: string | null | undefined, locale = "de") => (c ? new Intl.DisplayNames([locale], { type: "region" }).of(c) ?? c : "");
