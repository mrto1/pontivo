import { env } from "../../env";
import { GOOGLE_PATHS, parseReply, type GoogleKind, type GoogleReply } from "../../domain/google-hotels";

/** Fehler beim Senden an Google; `retryable` = später nochmals versuchen (Netz, 5xx, 429) */
export class GoogleHttpError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
  }
}

/** Gesendet wird nur mit Partner-Schlüssel und GOOGLE_HOTELS_SEND=1 (sonst Trockenlauf: Nachrichten werden erzeugt, nicht gesendet) */
export const googleSendEnabled = () => !!env().GOOGLE_HOTELS_PARTNER_KEY && env().GOOGLE_HOTELS_SEND === "1";
export const partnerKey = () => env().GOOGLE_HOTELS_PARTNER_KEY ?? "";

/**
 * Eine ARI-Nachricht senden: HTTP POST, Content-Type application/xml, Host www.google.com (Pfade in GOOGLE_PATHS).
 * Die Anmeldung läuft über die im Hotel Center eingetragenen IP-Adressen der Plattform (keine Zugangsdaten im Request).
 * HTTP 200 heisst nur «angekommen»; ob die Daten angenommen wurden, steht im Text der Antwort.
 */
export async function postGoogle(kind: GoogleKind, xml: string, fetchImpl: typeof fetch = fetch): Promise<GoogleReply> {
  let res: Response;
  try {
    res = await fetchImpl(`${env().GOOGLE_HOTELS_BASE_URL}${GOOGLE_PATHS[kind]}`, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: xml,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new GoogleHttpError(`Google nicht erreichbar: ${(e as Error).message}`, true);
  }
  const body = await res.text();
  if (!res.ok) throw new GoogleHttpError(`Google HTTP ${res.status}: ${body.slice(0, 300)}`, res.status === 429 || res.status >= 500, res.status);
  return parseReply(body);
}
