import { verifyTurnstile } from "../integrations/turnstile";
import { checkGuardForm } from "./form-guard";
import { rateLimitDb } from "./rate-limit-db";
import { sha256 } from "../domain/ids";
import { env } from "../env";

/**
 * Prüfung für öffentliche Formulare: Honeypot, Mindestzeit, dann Turnstile.
 * «bot»: Honeypot ausgefüllt, still so tun, als wäre alles gut. «retry»: zu schnell oder Token ungültig (ein Mensch kann es nochmals versuchen).
 */
export async function checkPublicForm(f: FormData, ip: string, opts: { turnstile?: boolean; minMs?: number } = {}): Promise<"ok" | "bot" | "retry" | "turnstile"> {
  const g = checkGuardForm(f, Date.now(), opts.minMs);
  if (!g.ok) return g.reason === "honeypot" ? "bot" : "retry";
  if (opts.turnstile !== false && !(await verifyTurnstile(String(f.get("cf-turnstile-response") ?? ""), ip))) return "turnstile";
  return "ok";
}

export const emailKey = (email: string) => sha256(email.trim().toLowerCase()).slice(0, 32);

/** Begrenzung je IP und je E-Mail-Adresse (Datenbank). Gibt false zurück, wenn eine der beiden Grenzen erreicht ist. */
export async function limitByIpAndEmail(scope: string, ip: string, email: string, o: { ipLimit: number; ipWindowMs: number; emailLimit: number; emailWindowMs: number }): Promise<boolean> {
  // Entwicklung und Tests: Browser-Tests laufen alle von derselben IP, deshalb dort weit höhere IP-Grenze
  const ipLimit = env().NODE_ENV === "production" ? o.ipLimit : o.ipLimit * 20;
  const a = await rateLimitDb(`${scope}-ip:${ip}`, ipLimit, o.ipWindowMs);
  const b = email ? await rateLimitDb(`${scope}-mail:${emailKey(email)}`, o.emailLimit, o.emailWindowMs) : true;
  return a && b;
}
