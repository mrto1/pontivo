import { env } from "../env";

/**
 * Cloudflare Turnstile, serverseitige Prüfung (Siteverify):
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 * Token: einmal verwendbar, 300 Sekunden gültig. Ohne Schlüssel ist die Prüfung aus (Entwicklung, Tests).
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstileEnabled = () => !!(env().TURNSTILE_SITE_KEY && env().TURNSTILE_SECRET_KEY);

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
let fetchImpl: Fetch = (url, init) => fetch(url, init);
/** Nur für Tests */
export const setTurnstileFetch = (f: Fetch | null) => { fetchImpl = f ?? ((url, init) => fetch(url, init)); };

export async function verifyTurnstile(token: string | null | undefined, ip?: string): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: env().TURNSTILE_SECRET_KEY!, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetchImpl(VERIFY_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!res.ok) return false;
    const j = (await res.json()) as { success?: boolean; hostname?: string };
    if (!j.success) return false;
    // Das Token muss auf unserer Domain erzeugt worden sein (Schutz vor Token von fremden Seiten)
    const host = new URL(env().APP_BASE_URL).hostname;
    return !j.hostname || j.hostname === host || j.hostname.endsWith(`.${host}`) || host === "localhost";
  } catch {
    return false; // Prüfung nicht erreichbar: nicht durchlassen (Fail-closed); der Nutzer kann es nochmals versuchen
  }
}
