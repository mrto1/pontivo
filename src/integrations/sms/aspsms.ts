import { env } from "../../env";

/**
 * SMS über ASPSMS (SPEC 20.4), JSON-API `SendTextSMS` (https://json.aspsms.com): POST mit UserName, Password, Originator,
 * Recipients (Liste), MessageText; Antwort StatusCode, StatusInfo.
 * ASSUMPTION: StatusCode «1» bedeutet Erfolg (in der Doku nicht ausdrücklich genannt, QUESTIONS.md).
 */
export type SmsResult = { ok: true } | { ok: false; error: string };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;
let fetchOverride: Fetch | null = null;
/** Für Tests: HTTP-Aufruf ersetzen */
export function setSmsFetch(f: Fetch | null) { fetchOverride = f; }

export const smsConfigured = () => !!(env().ASPSMS_USERKEY && env().ASPSMS_PASSWORD);

/** Schweizer Nummer in internationales Format (+41…); null, wenn unbrauchbar */
export function normalizePhone(raw: string): string | null {
  let p = raw.replace(/[\s\-./()]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (/^0\d{9}$/.test(p)) p = `+41${p.slice(1)}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

export async function sendSms(to: string, text: string): Promise<SmsResult> {
  if (!smsConfigured()) return { ok: false, error: "not_configured" };
  const f: Fetch = fetchOverride ?? ((u, init) => fetch(u, init));
  try {
    const res = await f("https://json.aspsms.com/SendTextSMS", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ UserName: env().ASPSMS_USERKEY, Password: env().ASPSMS_PASSWORD, Originator: env().ASPSMS_ORIGINATOR, Recipients: [to], MessageText: text.slice(0, 459), ForceGSM7bit: false }),
    });
    const body = await res.text();
    if (res.status < 200 || res.status >= 300) return { ok: false, error: `HTTP ${res.status}` };
    const j = JSON.parse(body) as { StatusCode?: string | number; StatusInfo?: string };
    return String(j.StatusCode) === "1" ? { ok: true } : { ok: false, error: `${j.StatusCode ?? "?"} ${j.StatusInfo ?? ""}`.trim().slice(0, 200) };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}
