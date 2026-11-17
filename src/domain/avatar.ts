/** Initialen für das Profilbild in der Kopfzeile: aus dem Namen, sonst aus dem Teil der E-Mail-Adresse vor dem @ */
export function initials(name: string | null | undefined, email: string): string {
  const pick = (s: string) => s.split(/[\s._+-]+/).filter((p) => /\p{L}/u.test(p)).map((p) => [...p].find((c) => /\p{L}/u.test(c))!);
  const parts = pick((name ?? "").trim()).length ? pick(name!.trim()) : pick(email.split("@")[0] ?? "");
  if (!parts.length) return "?";
  const out = parts.length === 1 ? [...(name?.trim() || email.split("@")[0]).replace(/[^\p{L}]/gu, "")].slice(0, 2) : [parts[0], parts[parts.length - 1]];
  return out.join("").toLocaleUpperCase("de-CH");
}
