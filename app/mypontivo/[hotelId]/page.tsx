import { redirect } from "next/navigation";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { requireHotel } from "@/src/auth/guard";
import { hasArea, isLimitedRole, landingFor, seesDay } from "@/src/domain/roles";
import { addDays, isDay } from "@/src/domain/dates";
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

function List({ title, rows, hotelId, empty }: { title: string; rows: DayRow[]; hotelId: string; empty: string }) {
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>{title} ({rows.length})</h2>
      {rows.length ? (
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Gast</th><th>Personen</th><th>Zimmer</th><th>Aufenthalt</th><th>Buchung</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bookingId}>
                <td>{r.guest}{r.guestCheckedOut ? <> <span className="badge">ausgecheckt (Portal)</span></> : null}</td>
                <td>{r.persons}</td>
                <td>{r.rooms.length ? r.rooms.join(", ") : <span className="muted small">{r.typeNames.join(", ")} (nicht zugewiesen)</span>}</td>
                <td className="small">{formatDay(r.checkin, "de")} – {formatDay(r.checkout, "de")}</td>
                <td><a href={`/mypontivo/${hotelId}/bookings/${r.bookingId}`}>{r.reference}</a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <p className="muted small" style={{ margin: 0 }}>{empty}</p>}
    </section>
  );
}

/** Startseite «Tag» (SPEC 19.42): Hinweise und Offenes für heute, An-/Abreisen und Gäste im Haus für jeden Tag (`?day=`). Kennzahlen mit Zeitraum stehen unter Finanzen → Statistik. */
export default async function Overview({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "home");
  if (isLimitedRole(role) && !seesDay(role)) redirect(`/mypontivo/${hotel.id}/${landingFor(role)}`);
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
  const limited = isLimitedRole(role);
  const inbox = (isOn(rows, "inquiries") || isOn(rows, "inbox")) && hasArea(role, "inbox");
  const day0 = sp.day && isDay(sp.day) ? sp.day : undefined;
  const v = await todayView(hotel, { day: day0, manages, inquiries: isOn(rows, "inquiries"), invoicing: isOn(rows, "invoicing") && !limited, inboxVisible: inbox });
  const isToday = v.day === v.today;
  const showPlan = isOn(rows, "frontdesk") && hasArea(role, "plan");
  const base = `/mypontivo/${hotel.id}`;
  const noData = isToday && !v.notices.length && !v.arrivals.length && !v.departures.length && !v.inHouse.length && !v.balances?.length && !v.overdue?.length;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Tag</h1>
      <PeriodNav prev={`${base}?day=${addDays(v.day, -1)}`} next={`${base}?day=${addDays(v.day, 1)}`} todayHref={base} todayActive={isToday} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: v.day, param: "day" }}>
        {showPlan ? <a className="btn secondary small" href={`${base}/plan`}>Zimmerplan</a> : null}
      </PeriodNav>
      <p className="muted" style={{ margin: 0 }}>{isToday ? "Heute, " : ""}{formatDay(v.day, "de")}</p>

      {v.notices.length ? (
        <section className="stack" aria-label="Hinweise">
          {v.notices.map((n) => (
            <a key={n.key} href={n.href} className={`notice${n.tone === "warn" ? " warn" : ""}`} style={{ display: "block", textDecoration: "none", color: "inherit" }}>{n.text} <strong>→</strong></a>
          ))}
        </section>
      ) : null}

      <List title={isToday ? "Anreisen heute" : "Anreisen"} rows={v.arrivals} hotelId={hotel.id} empty="Keine Anreisen." />
      <List title={isToday ? "Abreisen heute" : "Abreisen"} rows={v.departures} hotelId={hotel.id} empty="Keine Abreisen." />
      <List title="Im Haus" rows={v.inHouse} hotelId={hotel.id} empty="Niemand im Haus." />

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
