import { env } from "@/src/env";

// Zur Laufzeit erzeugt (braucht APP_BASE_URL); beim Build gibt es keine Produktions-Umgebung.
export const dynamic = "force-dynamic";

const sec = [{ bearer: [] }];
const err = (d: string) => ({ description: d, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const ref = { name: "reference", in: "path", required: true, schema: { type: "string" } };

/** OpenAPI 3.0 der Website-Schnittstelle (SPEC 19.22), öffentlich lesbar, ohne Schlüssel */
export function GET() {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Pontivo Website-Schnittstelle", version: "1.0.0", description: "Verfügbarkeit, Preise, Buchung und Storno für die eigene Hotel-Website. Beträge in Rappen (CHF). Schlüssel nur serverseitig verwenden." },
    servers: [{ url: `${env().APP_BASE_URL}/api/v1` }],
    security: sec,
    paths: {
      "/hotel": { get: { summary: "Stammdaten: Betrieb, Zimmertypen, Tarife, Zusatzleistungen", responses: { "200": { description: "OK" }, "401": err("Schlüssel fehlt oder ungültig"), "403": err("Modul aus, falscher Zweck oder IP nicht erlaubt") } } },
      "/availability": { get: { summary: "Verfügbarkeit und Preise", parameters: ["checkin", "checkout", "adults", "children", "rooms", "ages", "lang", "company_code"].map((n) => ({ name: n, in: "query", required: n === "checkin" || n === "checkout", schema: { type: "string" } })), responses: { "200": { description: "Angebote" }, "400": err("Eingabe ungültig"), "422": err("Suche nicht möglich (z. B. child_ages_required)") } } },
      "/bookings": { post: { summary: "Buchung anlegen (Reservation 32 Minuten, danach Zahlung)", parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 128 }, description: "Gleicher Schlüssel und gleiche Anfrage: gleiche Antwort, nichts doppelt." }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BookingRequest" } } } }, responses: { "201": { description: "Angelegt; checkout_url ist die Zahlungsseite" }, "400": err("Eingabe ungültig"), "409": err("Ausgebucht oder Anfrage läuft noch"), "413": err("Anfrage zu gross"), "422": err("Idempotency-Key mit anderem Inhalt"), "429": err("Zu viele Anfragen") } } },
      "/bookings/{reference}": {
        get: { summary: "Status einer Buchung", parameters: [ref], responses: { "200": { description: "OK" }, "404": err("Nicht gefunden") } },
        patch: { summary: "Nachträglich ändern: neues checkin (gleiche Nächte, gleiche Zimmer, Preis muss gleich bleiben) und/oder Name/Telefon des Gasts; dry_run prüft nur", parameters: [ref, { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 128 } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { checkin: { type: "string", format: "date" }, guest: { type: "object", additionalProperties: false, properties: { first_name: { type: "string" }, last_name: { type: "string" }, phone: { type: ["string", "null"] } } }, dry_run: { type: "boolean" } } } } } }, responses: { "200": { description: "Geändert (oder bei dry_run: möglich)" }, "400": err("Eingabe ungültig"), "404": err("Nicht gefunden"), "409": err("Nicht möglich: ausgebucht, anderer Preis (price_differs), nicht bestätigt, Portal-Buchung") } },
      },
      "/bookings/{reference}/cancel": {
        get: { summary: "Stornovorschau (Rückerstattung und Gebühr)", parameters: [ref], responses: { "200": { description: "OK" } } },
        post: { summary: "Stornieren (wie ein Gast)", parameters: [ref], responses: { "200": { description: "Storniert (auch bei Wiederholung)" }, "409": err("Nicht stornierbar") } },
      },
    },
    webhooks: {
      "booking.confirmed": { post: { summary: "Buchung bezahlt und bestätigt", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Event" } } } }, responses: { "200": { description: "2xx = angekommen" } } } },
      "booking.changed": { post: { summary: "Buchung verschoben oder Gästedaten geändert (changed = Liste der Felder)", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Event" } } } }, responses: { "200": { description: "2xx = angekommen" } } } },
      "booking.cancelled": { post: { summary: "Buchung storniert", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Event" } } } }, responses: { "200": { description: "2xx = angekommen" } } } },
      "booking.expired": { post: { summary: "Reservation nicht bezahlt, Zimmer wieder frei", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Event" } } } }, responses: { "200": { description: "2xx = angekommen" } } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "pnt_… (Admin → Website-Schnittstelle)" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
        BookingRequest: { type: "object", required: ["room_type_id", "rate_plan_id", "checkin", "checkout", "adults", "guest", "terms_accepted"], properties: {
          room_type_id: { type: "string", format: "uuid" }, rate_plan_id: { type: "string", format: "uuid" }, checkin: { type: "string", format: "date" }, checkout: { type: "string", format: "date" },
          adults: { type: "integer" }, children: { type: "integer" }, children_ages: { type: "array", items: { type: "integer" } }, rooms: { type: "integer", default: 1 },
          guest: { type: "object", required: ["first_name", "last_name", "email"], properties: { first_name: { type: "string" }, last_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, language: { type: "string", enum: ["de", "en", "fr", "it", "nl"] }, notes: { type: "string" }, marketing_consent: { type: "boolean" } } },
          terms_accepted: { type: "boolean", enum: [true] }, voucher_code: { type: "string" }, company_code: { type: "string", description: "Firmencode (Rabatt, optional auf Rechnung)" }, extras: { type: "array", items: { type: "object", properties: { id: { type: "string" }, quantity: { type: "integer" } } } },
          return_url: { type: "string", description: "Rückkehr nach der Zahlung; Ursprung muss im Admin erlaubt sein. Es werden reference und result (paid|cancelled) angehängt." }, embedded: { type: "boolean", description: "true: Zahlung eingebettet. Die Antwort enthält statt checkout_url die Felder client_secret, stripe_account und publishable_key (Stripe.js mit stripeAccount initialisieren, createEmbeddedCheckoutPage)." } } },
        Event: { type: "object", properties: { id: { type: "string", format: "uuid" }, type: { type: "string" }, created_at: { type: "string", format: "date-time" }, data: { type: "object", description: "reference, status, checkin, checkout, adults, children, total_rappen, source; bei Storno zusätzlich refund_rappen, fee_rappen. Keine Gästedaten." } } },
      },
    },
    "x-webhook-signature": "Header Pontivo-Signature: t=<unix>,v1=<hex>. v1 = HMAC-SHA256 über '<t>.<Rumpf>' mit dem Geheimnis der Adresse. Zeitstempel höchstens 5 Minuten alt akzeptieren. Wiederholung bei Fehlern nach 1 Min, 5 Min, 30 Min, 2 Std, 12 Std, 24 Std; Ereignis-ID id ist bei Wiederholungen gleich.",
  };
  return Response.json(spec, { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
