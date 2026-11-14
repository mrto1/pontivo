/**
 * Nuki Web API (Swagger 4.26.0, https://api.nuki.io). Verwendete Endpunkte (laut Swagger-Datei):
 *  GET /smartlock · GET/PUT /smartlock/{id}/auth · POST/DELETE /smartlock/{id}/auth/{authId}  (Scope smartlock.auth)
 * ASSUMPTION: Basis-URL https://api.nuki.io und «Authorization: Bearer <API-Token>» (API-Token aus Nuki Web); beides steht nicht in der Swagger-Datei.
 * ASSUMPTION: Datumsfelder im ISO-8601-Format (UTC), Typ 13 = Keypad-Code (Swagger: type 13 .. keypad).
 * Anlegen/Ändern/Löschen antwortet 204 und läuft asynchron: die Auth-ID kommt erst über die Liste.
 */
export class NukiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

export type NukiLock = { smartlockId: number; name: string; type: number };
export type NukiAuth = { id: string; name: string; type: number; code?: number; enabled: boolean; error?: string };

let fetchImpl: typeof fetch | null = null;
/** Für Tests */
export function setNukiFetch(f: typeof fetch | null) { fetchImpl = f; }
const base = () => process.env.NUKI_API_BASE ?? "https://api.nuki.io";

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await (fetchImpl ?? fetch)(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const hint = res.status === 401 ? "Token ungültig oder ohne Recht «smartlock.auth»" : res.status === 409 ? "Code oder Name bereits vergeben" : res.status === 423 ? "Schloss ist gerade beschäftigt" : `Fehler ${res.status}`;
    throw new NukiError(`Nuki: ${hint}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const listSmartlocks = (token: string) => call<NukiLock[]>(token, "GET", "/smartlock");
export const listAuths = (token: string, smartlockId: number) => call<NukiAuth[]>(token, "GET", `/smartlock/${smartlockId}/auth`);
export const createKeypadAuth = (token: string, smartlockId: number, a: { name: string; code: number; from: Date; until: Date }) =>
  call<void>(token, "PUT", `/smartlock/${smartlockId}/auth`, {
    name: a.name, type: 13, code: a.code, remoteAllowed: false,
    allowedFromDate: a.from.toISOString(), allowedUntilDate: a.until.toISOString(),
  });
export const deleteAuth = (token: string, smartlockId: number, authId: string) => call<void>(token, "DELETE", `/smartlock/${smartlockId}/auth/${authId}`);
