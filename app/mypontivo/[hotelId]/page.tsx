import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { isLimitedRole, landingFor } from "@/src/domain/roles";
import { atLeast } from "@/src/auth/session";
import { formatChf } from "@/src/domain/money";
import { setupOpen } from "@/src/domain/setup";
import { onboardingSteps, nextOpenStep } from "@/src/services/onboarding";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { todayView } from "@/src/services/today";
import { formatDay } from "@/src/i18n/dict";
import type { DayRow } from "@/src/services/frontdesk";

export const dynamic = "force-dynamic";

function Rows({ rows, hotelId, empty }: { rows: DayRow[]; hotelId: string; empty: string }) {
  if (!rows.length) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.bookingId}>
          <a href={`/mypontivo/${hotelId}/bookings/${r.bookingId}`}><strong>{r.guest}</strong></a>
          <span className="muted small"> · {r.persons} Pers. · {r.rooms.length ? `Zimmer ${r.rooms.join(", ")}` : `${r.typeNames.join(", ")} (nicht zugewiesen)`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Startseite «Tag»: nur der heutige Tag. Kennzahlen mit Zeitraum stehen unter Finanzen → Statistik. */
export default async function Overview({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "home");
  if (isLimitedRole(role)) redirect(`/mypontivo/${hotel.id}/${landingFor(role)}`);
  const manages = atLeast(role, "manager");
  // Einrichtung läuft: «Tag» zeigt die Einrichtungskarte (das Menü bleibt voll, nichts ist gesperrt)
  if (manages && setupOpen(hotel)) {
    const steps = await onboardingSteps(hotel);
    const next = nextOpenStep(steps);
    const done = steps.filter((x) => x.done).length;
    return (
      <div className="stack">
        <h1 style={{ margin: 0 }}>Willkommen bei myPontivo</h1>
        <section className="card stack setup-card">
          <div className="setup-head">
            <div>
              <h2 style={{ margin: 0 }}>Einrichtung: {done} von {steps.length} Schritten</h2>
              <p className="muted small" style={{ margin: "4px 0 0" }}>Sobald Zimmer und Preise erfasst sind und Sie online gehen, füllen sich Kalender, Statistik und diese Übersicht. Alle Seiten können Sie schon jetzt ansehen.</p>
            </div>
            <a className="btn" href={`/mypontivo/${hotel.id}/einrichten?step=${next}`}>Einrichtung fortsetzen</a>
          </div>
          <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Fortschritt der Einrichtung"><span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></div>
          <ol className="setup-steps">
            {steps.map((x) => (
              <li key={x.key} className={x.done ? "done" : x.key === next ? "next" : undefined}>
                <span className="setup-mark" aria-hidden="true">{x.done ? "✓" : ""}</span>
                <a href={`/mypontivo/${hotel.id}/einrichten?step=${x.key}`}>{x.title}</a>
                {x.done ? <span className="muted small">erledigt</span> : x.key === next ? <span className="badge">als Nächstes</span> : x.required ? null : <span className="muted small">optional</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }
  const rows = await moduleRows(hotel.id);
  const inbox = isOn(rows, "inquiries") || isOn(rows, "inbox");
  const v = await todayView(hotel, { manages, frontdesk: isOn(rows, "frontdesk"), inquiries: isOn(rows, "inquiries"), invoicing: isOn(rows, "invoicing"), inboxVisible: inbox });
  const base = `/mypontivo/${hotel.id}`;
  const noData = !v.notices.length && v.arrivals === null && !v.balances?.length && !v.overdue?.length;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Tag</h1>
      <p className="muted" style={{ margin: 0 }}>Heute, {formatDay(v.today, "de")}</p>

      {v.notices.length ? (
        <section className="stack" aria-label="Hinweise">
          {v.notices.map((n) => (
            <a key={n.key} href={n.href} className={`notice${n.tone === "warn" ? " warn" : ""}`} style={{ display: "block", textDecoration: "none", color: "inherit" }}>{n.text} <strong>→</strong></a>
          ))}
        </section>
      ) : null}

      {v.arrivals !== null && v.departures !== null ? (
        <div className="grid2">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Anreisen heute ({v.arrivals.length})</h2>
            <Rows rows={v.arrivals} hotelId={hotel.id} empty="Keine Anreisen." />
          </section>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Abreisen heute ({v.departures.length})</h2>
            <Rows rows={v.departures} hotelId={hotel.id} empty="Keine Abreisen." />
          </section>
          <p className="muted small" style={{ margin: 0, gridColumn: "1 / -1" }}>{v.inHouse} Gäste-Buchungen im Haus. <a href={`${base}/frontdesk`}>Alle An- und Abreisen</a></p>
        </div>
      ) : null}

      {v.balances?.length || v.overdue?.length ? (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Offene Zahlungen</h2>
          {v.balances?.length ? (
            <>
              <h3 style={{ margin: 0 }}>Restzahlungen für laufende und bald beginnende Aufenthalte</h3>
              <ul className="list">
                {v.balances.map((b) => <li key={b.bookingId}><a href={`${base}/bookings/${b.bookingId}`}><strong>{b.guest}</strong></a> <span className="muted small">· {b.reference} · Anreise {formatDay(b.checkin, "de")}</span> · {formatChf(b.amountRappen)}</li>)}
              </ul>
            </>
          ) : null}
          {v.overdue?.length ? (
            <>
              <h3 style={{ margin: 0 }}>Überfällige Rechnungen</h3>
              <ul className="list">
                {v.overdue.map((i) => <li key={i.id}><strong>{i.number}</strong> <span className="muted small">· {i.payer} · {i.daysOverdue} Tage überfällig</span> · {formatChf(i.openRappen)}</li>)}
              </ul>
              <p className="small" style={{ margin: 0 }}><a href={`${base}/invoices`}>Zu den Rechnungen</a></p>
            </>
          ) : null}
        </section>
      ) : null}

      {noData ? <p className="muted">Heute ist nichts offen.</p> : null}
    </div>
  );
}
