import { pool } from "../db/client";
import { healthOf, type Health, type HealthSignals } from "../domain/health";

/** Messwerte aller Betriebe in wenigen Abfragen (Plattform-Verwaltung, Vertriebs-Cockpit, Monatsmail) */
export async function healthSignals(now = new Date()): Promise<Map<string, HealthSignals & { name: string }>> {
  const q = (s: string, p: unknown[] = []) => pool().query(s, p).then((r) => r.rows);
  const [hotels, bk, hz, feeds, cx, act, failed] = await Promise.all([
    q(`SELECT id, name, status, created_at, live_since, stripe_charges_enabled, billing_payment_method_id, billing_method, onboarding FROM hotels`),
    q(`SELECT hotel_id,
              count(*) FILTER (WHERE confirmed_at >= $1::timestamptz - interval '30 days')::int AS b30,
              count(*) FILTER (WHERE confirmed_at >= $1::timestamptz - interval '60 days' AND confirmed_at < $1::timestamptz - interval '30 days')::int AS bprev
         FROM bookings WHERE source = 'direct' AND status = 'confirmed' AND confirmed_at IS NOT NULL GROUP BY hotel_id`, [now]),
    q(`SELECT hotel_id, (max(night) - ($1::timestamptz AT TIME ZONE 'Europe/Zurich')::date)::int AS h FROM rates_days GROUP BY hotel_id`, [now]),
    q(`SELECT hotel_id, count(*)::int AS n FROM ical_feeds WHERE active AND last_error IS NOT NULL GROUP BY hotel_id`),
    q(`SELECT hotel_id, count(*)::int AS n FROM channex_outbox WHERE status = 'failed' AND next_attempt_at > $1::timestamptz - interval '7 days' GROUP BY hotel_id`, [now]),
    q(`SELECT hotel_id, max(created_at) AS last FROM audit_log WHERE hotel_id IS NOT NULL AND actor LIKE 'user:%' GROUP BY hotel_id`),
    q(`SELECT hotel_id, count(*)::int AS n FROM platform_charges WHERE status = 'failed' GROUP BY hotel_id`),
  ]);
  const by = <T extends { hotel_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.hotel_id, r]));
  const B = by(bk), H = by(hz), F = by(feeds), C = by(cx), A = by(act), X = by(failed);
  const days = (d: Date) => Math.floor((now.getTime() - new Date(d).getTime()) / 864e5);
  const out = new Map<string, HealthSignals & { name: string }>();
  for (const h of hotels) {
    out.set(h.id, {
      name: h.name, status: h.status, ageDays: days(h.created_at), liveDays: h.live_since ? days(h.live_since) : null,
      stripeChargesEnabled: h.stripe_charges_enabled, hasCard: !!h.billing_payment_method_id || h.billing_method === "qr", failedCharges: X.get(h.id)?.n ?? 0,
      bookings30: B.get(h.id)?.b30 ?? 0, bookingsPrev30: B.get(h.id)?.bprev ?? 0, horizonDays: H.get(h.id)?.h ?? 0,
      feedErrors: F.get(h.id)?.n ?? 0, channexErrors: C.get(h.id)?.n ?? 0,
      idleDays: A.get(h.id) ? days(A.get(h.id)!.last) : null, onboardingDone: !!h.onboarding?.completedAt,
    });
  }
  return out;
}

export async function healthByHotel(now = new Date()): Promise<Map<string, Health & { name: string; signals: HealthSignals }>> {
  const s = await healthSignals(now);
  return new Map([...s].map(([id, sig]) => [id, { ...healthOf(sig), name: sig.name, signals: sig }]));
}
