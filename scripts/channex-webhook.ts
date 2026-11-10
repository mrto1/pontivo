/**
 * Channex-Webhook für Buchungen einrichten (einmal pro Umgebung: Staging, Produktion).
 *   node --import tsx scripts/channex-webhook.ts [Callback-URL] [--new-key] [--remove-others]
 * Standard-URL: <APP_BASE_URL>/api/webhooks/channex
 *
 * - Signierschlüssel (HMAC) für das Channex-Konto anlegen, falls keiner da ist (oder mit --new-key).
 *   Das Geheimnis zeigt Channex nur einmal → als CHANNEX_WEBHOOK_SECRET eintragen.
 * - Globalen Webhook (alle Betriebe) für Ereignis «booking», signiert, ohne Daten (send_data=false):
 *   Der Webhook stösst nur den Feed an, die Buchung selbst kommt immer über den Feed mit Ack (SPEC 7.3).
 * Geprüft gegen Channex-Staging am 10.11.2026 (signing_keys, webhooks).
 */
import { env, requireEnv } from "../src/env";

const base = env().CHANNEX_BASE_URL.replace(/\/$/, "");
const args = process.argv.slice(2);
const callback = args.find((a) => /^https?:\/\//.test(a)) ?? `${env().APP_BASE_URL}/api/webhooks/channex`;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "user-api-key": requireEnv("CHANNEX_API_KEY"), "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}
type One<A> = { data: { id: string; attributes: A } };
type Many<A> = { data: { id: string; attributes: A }[] };

const ba = await api<One<{ company_name: string }>>("GET", "/billing_accounts");
console.log(`Channex-Konto: ${ba.data.attributes.company_name} (${base})`);

const keys = await api<Many<{ title: string }>>("GET", `/signing_keys?filter[billing_account_id]=${ba.data.id}`);
let keyId = keys.data[0]?.id;
if (!keyId || args.includes("--new-key")) {
  const k = await api<One<{ secret: string }>>("POST", "/signing_keys", { signing_key: { billing_account_id: ba.data.id, title: `Pontivo ${new Date().toISOString().slice(0, 10)}` } });
  keyId = k.data.id;
  console.log("\nNeuer Signierschlüssel. Dieses Geheimnis wird nur jetzt angezeigt – in .env.production eintragen:\n");
  console.log(`CHANNEX_WEBHOOK_SECRET=${k.data.attributes.secret}\n`);
} else {
  console.log(`Signierschlüssel vorhanden: ${keys.data[0].attributes.title} (Geheimnis steht bereits in CHANNEX_WEBHOOK_SECRET; sonst mit --new-key neu anlegen)`);
}

const hooks = await api<Many<{ callback_url: string; is_global: boolean; event_mask: string; is_active: boolean }>>("GET", "/webhooks");
const existing = hooks.data.find((h) => h.attributes.callback_url === callback && h.attributes.is_global);
const webhook = { callback_url: callback, event_mask: "booking", property_id: null, is_global: true, is_signed: true, signing_key_id: keyId, request_params: {}, headers: {}, is_active: true, send_data: false };
if (existing) {
  await api("PUT", `/webhooks/${existing.id}`, { webhook });
  console.log(`Webhook aktualisiert: ${callback}`);
} else {
  await api("POST", "/webhooks", { webhook });
  console.log(`Webhook angelegt: ${callback}`);
}
const others = hooks.data.filter((h) => h.attributes.callback_url !== callback);
if (others.length && args.includes("--remove-others")) {
  // z. B. alte Test-Weiterleitungen (smee.io) oder eine frühere Server-Adresse
  for (const h of others) {
    await api("DELETE", `/webhooks/${h.id}`);
    console.log(`Webhook gelöscht: ${h.attributes.callback_url}`);
  }
} else if (others.length) {
  console.log(`Weitere Webhooks im Konto (prüfen, mit --remove-others löschen): ${others.map((h) => h.attributes.callback_url).join(", ")}`);
}
