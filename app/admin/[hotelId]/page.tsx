import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { isLimitedRole, LANDING } from "@/src/domain/roles";
import { atLeast } from "@/src/auth/session";
import { bpsOf, formatChf } from "@/src/domain/money";
import { overview, PERIOD_LABEL, PERIODS, setOtaCommission, type Period } from "@/src/services/overview";
import { setupOpen } from "@/src/domain/setup";
import { onboardingSteps, nextOpenStep } from "@/src/services/onboarding";
import { DirectChart } from "@/components/admin/DirectChart";

export const dynamic = "force-dynamic";

async function saveCommission(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "manager");
  const pct = Number(String(f.get("pct") ?? "").replace(",", "."));
  if (Number.isFinite(pct) && pct >= 0 && pct <= 30) await setOtaCommission(c.hotel.id, Math.round(pct * 100), c.actor);
  redirect(`/admin/${c.hotel.id}?period=${String(f.get("period") ?? "month")}`);
}

const chf0 = (r: number) => formatChf(Math.round(r / 100) * 100).replace(/\.00$/, "");

export default async function Overview({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "home");
  if (isLimitedRole(role)) redirect(`/admin/${hotel.id}/${LANDING[role]}`);
  // Zahlen zu Umsatz und Gebühren nur für Inhaber und Geschäftsführung (wie die Abrechnung)
  if (!atLeast(role, "manager")) redirect(`/admin/${hotel.id}/bookings`);
  // Einrichtung läuft: Übersicht zeigt die Einrichtungskarte (das Menü bleibt voll, nichts ist gesperrt)
  if (setupOpen(hotel)) {
    const steps = await onboardingSteps(hotel);
    const next = nextOpenStep(steps);
    const done = steps.filter((x) => x.done).length;
    return (
      <div className="stack">
        <h1 style={{ margin: 0 }}>Willkommen bei myPontivo</h1>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Einrichtung: {done} von {steps.length} Schritten</h2>
          <p className="muted" style={{ margin: 0 }}>Sobald Zimmer und Preise erfasst sind und Sie online gehen, füllen sich Kalender, Statistik und diese Übersicht. Sie können jederzeit alle Seiten ansehen.</p>
          <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
            {steps.map((x) => (
              <li key={x.key}>
                <a href={`/admin/${hotel.id}/einrichten?step=${x.key}`}>{x.title}</a>
                {x.done ? <span className="badge" style={{ marginLeft: 8 }}>erledigt</span> : x.required ? null : <span className="muted small"> (optional)</span>}
              </li>
            ))}
          </ol>
          <p style={{ margin: 0 }}><a className="btn" href={`/admin/${hotel.id}/einrichten?step=${next}`}>Einrichtung fortsetzen</a></p>
        </section>
      </div>
    );
  }
  const period: Period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "month";
  const o = await overview(hotel, period);
  const pct = (o.commissionBps / 100).toLocaleString("de-CH");

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Übersicht</h1>
        <nav className="seg" aria-label="Zeitraum">
          {PERIODS.map((p) => (
            <a key={p} href={`?period=${p}`} aria-current={p === period ? "true" : undefined}>{PERIOD_LABEL[p]}</a>
          ))}
        </nav>
      </div>

      <section className="card hero-stat">
        <p className="muted small" style={{ margin: 0 }}>{PERIOD_LABEL[period]}: gespart gegenüber Buchungsportalen</p>
        <p className="hero-num">{chf0(o.savedRappen)}</p>
        {o.direct.bookings ? (
          <p className="muted small" style={{ margin: 0 }}>
            {o.direct.bookings} Direktbuchung{o.direct.bookings === 1 ? "" : "en"} · {o.direct.nights} Nächte · Zimmerumsatz {formatChf(o.direct.roomsRappen)}.
            {" "}Bei {pct} % Portal-Provision wären {formatChf(bpsOf(o.direct.roomsRappen, o.commissionBps))} angefallen, die Pontivo-Gebühr betrug {formatChf(o.direct.feeRappen)}.
          </p>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Noch keine Direktbuchungen in diesem Zeitraum.</p>
        )}
      </section>

      <div className="tiles">
        <div className="card tile">
          <span className="muted small">Direktanteil</span>
          <strong>{o.directSharePct === null ? "–" : `${o.directSharePct} %`}</strong>
          <span className="muted small">der Online-Buchungen</span>
        </div>
        <div className="card tile">
          <span className="muted small">Über Portale</span>
          <strong>{o.portal.bookings}</strong>
          <span className="muted small">Buchungen · {formatChf(o.portal.roomsRappen)}</span>
        </div>
        <div className="card tile">
          <span className="muted small">Gutscheine verkauft</span>
          <strong>{o.vouchers.sold}</strong>
          <span className="muted small">{formatChf(o.vouchers.rappen)}</span>
        </div>
        <div className="card tile">
          <span className="muted small">Anfragen</span>
          <strong>{o.inquiries}</strong>
          <span className="muted small"><a href={`/admin/${hotel.id}/inquiries`}>ansehen</a></span>
        </div>
      </div>

      <section className="card">
        <h2 style={{ fontSize: "1.15rem" }}>Buchungen pro Monat</h2>
        <DirectChart data={o.chart} />
      </section>

      <section className="card">
        <form action={saveCommission} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <input type="hidden" name="hotelId" value={hotel.id} />
          <input type="hidden" name="period" value={period} />
          <div>
            <label htmlFor="pct">Provision der Buchungsportale in %</label>
            <input id="pct" name="pct" type="number" min={0} max={30} step={0.5} defaultValue={o.commissionBps / 100} style={{ width: 120 }} />
          </div>
          <button className="btn secondary small">Speichern</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Tragen Sie die Provision ein, die Sie Booking.com &amp; Co. tatsächlich zahlen (steht im Vertrag oder auf der Rechnung).
          Gerechnet wird auf den Zimmerpreis ohne Kurtaxe. Kartengebühren sind nicht abgezogen, sie fallen bei Portalen oft ebenfalls an.
          Gezählt werden bestätigte Buchungen im Monat der Bestätigung; stornierte zählen nicht.
        </p>
      </section>
    </div>
  );
}
