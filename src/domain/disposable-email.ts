import list from "disposable-email-domains";

/** Wegwerf-Adressen (Mailinator, Guerrilla Mail usw.): Liste des Pakets «disposable-email-domains» (MIT), plus eigene Ergänzungen. */
const EXTRA = ["pontivo-test-blocked.invalid"];
const BLOCKED = new Set<string>([...(list as string[]), ...EXTRA]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  const parts = domain.split(".");
  // auch Unterdomains einer gesperrten Domain (a.b.mailinator.com)
  for (let i = 0; i < parts.length - 1; i++) if (BLOCKED.has(parts.slice(i).join("."))) return true;
  return false;
}
