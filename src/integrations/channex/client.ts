import { env, requireEnv } from "../../env";

/**
 * Channex REST API v1 (SPEC 7). Basis-URL aus CHANNEX_BASE_URL, Header `user-api-key`.
 * Doku: https://docs.channex.io/api-v.1-documentation/ari, …/bookings-collection, …/rate-limits
 */

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

let fetchOverride: FetchLike | null = null;
/** Für Tests: HTTP ersetzen */
export function setChannexFetch(f: FetchLike | null) {
  fetchOverride = f;
}

export class ChannexHttpError extends Error {
  constructor(public status: number, public body: unknown, msg: string) {
    super(msg);
  }
  /** 429 oder 5xx (oder Netzwerk) → später erneut versuchen */
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

export type AvailabilityValue = { property_id: string; room_type_id: string; date_from: string; date_to: string; availability: number };
export type RestrictionValue = {
  property_id: string;
  rate_plan_id: string;
  date_from: string;
  date_to: string;
  rate?: string;
  /** Statt `rate` bei Tarifen mit mehreren Belegungen (ARI-Doku: rates[].occupancy/rate) */
  rates?: { occupancy: number; rate: string }[];
  min_stay_arrival?: number;
  max_stay?: number;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
  stop_sell?: boolean;
};

export type AriResponse = { data?: unknown[]; meta?: { message?: string; warnings?: unknown[] } };

export type BookingRevision = {
  id: string;
  property_id: string;
  booking_id: string;
  unique_id?: string | null;
  system_id?: string | null;
  ota_reservation_code?: string | null;
  ota_name?: string | null;
  status: "new" | "modified" | "cancelled";
  rooms: {
    amount?: string | null;
    checkin_date: string;
    checkout_date: string;
    rate_plan_id: string | null;
    room_type_id: string | null;
    days?: Record<string, string> | null;
    occupancy?: { adults?: number; children?: number; infants?: number; ages?: number[] } | null;
  }[];
  customer?: { name?: string | null; surname?: string | null; mail?: string | null; phone?: string | null; language?: string | null } | null;
  occupancy?: { adults?: number; children?: number; infants?: number } | null;
  arrival_date: string;
  departure_date: string;
  amount?: string | null;
  currency?: string | null;
  notes?: string | null;
  inserted_at?: string | null;
};

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const url = `${env().CHANNEX_BASE_URL.replace(/\/$/, "")}${path}`;
  const f: FetchLike = fetchOverride ?? ((u, init) => fetch(u, init));
  let res;
  try {
    res = await f(url, {
      method,
      headers: { "user-api-key": requireEnv("CHANNEX_API_KEY"), "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ChannexHttpError(0, null, `Channex nicht erreichbar: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ChannexHttpError(res.status, json, `Channex ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return json as T;
}

export const channex = {
  postAvailability: (values: AvailabilityValue[]) => call<AriResponse>("POST", "/availability", { values }),
  postRestrictions: (values: RestrictionValue[]) => call<AriResponse>("POST", "/restrictions", { values }),
  /** Liefert nur nicht bestätigte Revisionen, älteste zuerst */
  feed: (propertyId?: string) =>
    call<{ data: { id: string; type: string; attributes: BookingRevision }[]; meta?: { total?: number } }>(
      "GET",
      `/booking_revisions/feed?order[inserted_at]=asc${propertyId ? `&filter[property_id]=${encodeURIComponent(propertyId)}` : ""}`,
    ),
  ack: (revisionId: string) => call<unknown>("POST", `/booking_revisions/${encodeURIComponent(revisionId)}/ack`),
  createProperty: (p: Record<string, unknown>) => call<{ data: { id: string } }>("POST", "/properties", { property: p }),
  createRoomType: (r: Record<string, unknown>) => call<{ data: { id: string } }>("POST", "/room_types", { room_type: r }),
  createRatePlan: (r: Record<string, unknown>) => call<{ data: { id: string } }>("POST", "/rate_plans", { rate_plan: r }),

  /** Gruppen der Property: data.relationships.groups.data[].id (Doku: Get Property API) */
  getProperty: (id: string) =>
    call<{ data: { id: string; relationships?: { groups?: { data?: { id: string; type: string }[] } } } }>("GET", `/properties/${encodeURIComponent(id)}`),

  // Channel API (Doku: Channel API + Booking.com-Leitfaden, docs.channex.io/api-v.1-documentation/channel-api)
  testConnection: (channel: string, settings: Record<string, unknown>) =>
    call<{ data: { success: boolean; errors: unknown } }>("POST", "/channels/test_connection", { channel, settings }),
  mappingDetails: (channel: string, settings: Record<string, unknown>) =>
    call<{ data: BookingMappingDetails }>("POST", "/channels/mapping_details", { channel, settings }),
  connectionDetails: (channel: string, settings: Record<string, unknown>) =>
    call<{ data: { type: string; attributes: { currency?: string } } }>("POST", "/channels/connection_details", { channel, settings }),
  createChannel: (c: Record<string, unknown>) => call<{ data: { id: string; attributes: { is_active: boolean; currency?: string | null } } }>("POST", "/channels", { channel: c }),
  updateChannel: (id: string, c: Record<string, unknown>) => call<{ data: { id: string } }>("PUT", `/channels/${encodeURIComponent(id)}`, { channel: c }),
  deleteChannel: (id: string) => call<unknown>("DELETE", `/channels/${encodeURIComponent(id)}`),
  checkReadiness: (id: string) =>
    call<{ data: { id: string; entity: string; relation: string; error_code: string }[] }>("POST", `/channels/${encodeURIComponent(id)}/check_readiness`),
  activateChannel: (id: string) => call<unknown>("POST", `/channels/${encodeURIComponent(id)}/activate`),
  deactivateChannel: (id: string) => call<unknown>("POST", `/channels/${encodeURIComponent(id)}/deactivate`),
  executeChannelAction: (id: string, action: string, body?: Record<string, unknown>) =>
    call<unknown>("POST", `/channels/${encodeURIComponent(id)}/execute/${encodeURIComponent(action)}`, body),
};

/** Antwort von mapping_details für Booking.com (Leitfaden Booking.com, Schritt 3) */
export type BookingRate = {
  id: number | string;
  title: string;
  max_persons: number | null;
  occupancies: number[];
  price_1: boolean | null;
  pricing: "OBP" | "Standard";
  parent_rate_id: string;
  readonly: boolean;
  derived_rate_plan_ids?: (number | string)[];
};
export type BookingRoom = { id: number | string; title: string; max_children: number | null; rates: BookingRate[] };
export type BookingMappingDetails = { pricing_type: "OBP" | "Standard"; rooms: BookingRoom[] };

export function channexConfigured(): boolean {
  return !!env().CHANNEX_API_KEY;
}
