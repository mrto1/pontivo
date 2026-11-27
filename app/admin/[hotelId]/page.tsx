import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { reservationsOfDay } from "@/src/services/reservations";
import { todayIn } from "@/src/domain/dates";
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
import { DINING_LABEL } from "@/src/admin/nav";
import { todayView } from "@/src/services/today";
import { formatDay } from "@/src/i18n/dict";
import type { DayRow } from "@/src/services/frontdesk";
import { arrivals as checkinStatus, verifyRegistration } from "@/src/services/guests";

export const dynamic = "force-dynamic";

type Reg = { registered: number; verified: boolean };

/** Ausweis am Empfang gesehen (SPEC 14.4); gehört zur Spalte «Meldeschein» der Anreisen */
async function verify(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "staff", "home");
  await verifyRegistration(c.hotel.id, String(f.get("bookingId")), c.actor);
  redirect(`/admin/${c.hotel.id}?day=${String(f.get("day"))}`);
}

function List({ title, rows, hotelId, empty, reg, day }: { title: string; rows: DayRow[]; hotelId: string; empty: string; reg?: Map<string, Reg>; day?: string }) {
  return (
    <section className="card stack">
      <h2 className="m0">{title} ({rows.length})</h2>
      {rows.length ? (
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Gast</th><th>Personen</th><th>Zimmer</th><th>Aufenthalt</th><th>Buchung</th>{reg ? <th>Meldeschein</th> : null}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bookingId}>
                <td>{r.guest}{r.guestCheckedOut ? <> <span className="badge">ausgecheckt (Portal)</span></> : null}</td>
                <td>{r.persons}</td>
                <td>{r.rooms.length ? r.rooms.join(", ") : <span className="muted small">{r.typeNames.join(", ")} (nicht zugewiesen)</span>}</td>
                <td className="small">{formatDay(r.checkin, "de")} – {formatDay(r.checkout, "de")}</td>
                <td><a href={`/admin/${hotelId}/bookings/${r.bookingId}`}>{r.reference}</a></td>
                {reg ? (() => {
                  const g = reg.get(r.bookingId);
                  if (g?.verified) return <td><span className="badge">Ausweis geprüft</span></td>;
                  if (g && g.registered > 0) return <td><form action={verify} className="inline-form"><input type="hidden" name="hotelId" value={hotelId} /><input type="hidden" name="bookingId" value={r.bookingId} /><input type="hidden" name="day" value={day ?? ""} /><span className="small">ausgefüllt</span> <button className="btn secondary small">Ausweis gesehen</button></form></td>;
                  return <td className="muted small">offen</td>;
                })() : null}
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <p className="muted small m0">{empty}</p>}
    </section>
  );
}

/** Startseite «Tag» (SPEC 19.42): Hinweise und Offenes für heute, An-/Abreisen und Gäste im Haus für jeden Tag (`?day=`). Kennzahlen mit Zeitraum stehen unter Finanzen → Statistik. */
export default async function Overview({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role, user } = await requireHotel(hotelId, "staff", "home");
  if (isLimitedRole(role) && !seesDay(role)) redirect(`/admin/${hotel.id}/${landingFor(role)}`);
  // Zwei Bereiche (SPEC 20.1): reines Restaurant immer, sonst im zuletzt gewählten Bereich Gastronomie zur Tagesübersicht
  const rows0 = await moduleRows(hotel.id);
  if (isOn(rows0, "restaurant") && hasArea(role, "dininghome")) {
    const area = (await cookies()).get(`pv_area_${user.id.slice(0, 8)}`)?.value;
    if (hotel.propertyType === "restaurant" || (area === "dining" && !sp.day)) redirect(`/admin/${hotel.id}/restaurant/heute`);
  }
  const manages = atLeast(role, "manager");
  // Einrichtung läuft: «Tag» zeigt die Einrichtungskarte (das Menü bleibt voll, nichts ist gesperrt)
  if (manages && setupOpen(hotel)) {
    const steps = await onboardingSteps(hotel);
    const next = nextOpenStep(steps);
    const done = steps.filter((x) => x.done).length;
    return (
      <div className="stack">
        <h1 className="m0">Willkommen bei Pontivo</h1>
        <section className="card stack setup-card">
          <div className="setup-head">
            <div>
              <h2 className="m0">Einrichtung: {done} von {steps.length} Schritten</h2>
              <p className="muted small m-4-0-0">Sobald Zimmer und Preise erfasst sind und Sie online gehen, füllen sich Kalender, Statistik und diese Übersicht. Alle Seiten können Sie schon jetzt ansehen.</p>
            </div>
            <a className="btn" href={`/admin/${hotel.id}/einrichten?step=${next}`}>Einrichtung fortsetzen</a>
          </div>
          <div className="wizard-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Fortschritt der Einrichtung"><span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></div>
          <ul className="ready-list" data-testid="setup-steps">
            {steps.map((x) => {
              const href = `/admin/${hotel.id}/einrichten?step=${x.key}`;
              return (
                <li key={x.key} className={x.done ? "done" : x.key === next ? "next" : undefined}>
                  <span className="dot" aria-hidden="true">{x.done ? "✓" : ""}</span>
                  <span className="ready-text">
                    {x.done ? <span className="muted">{x.label ?? x.title}</span> : <a href={href}>{x.label ?? x.title}</a>}
                    {x.done ? null : x.key === next ? <span className="badge">als Nächstes</span> : x.required ? null : <span className="small muted">optional</span>}
                    {!x.done && x.hint ? <span className="small muted ready-hint">{x.hint}</span> : null}
                  </span>
                  {x.done ? null : <a className="ready-go" href={href} aria-hidden="true" tabIndex={-1}>→</a>}
                </li>
              );
            })}
          </ul>
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
  const base = `/admin/${hotel.id}`;
  // Meldeschein-Stand je Anreise, nur wenn die Funktion «Online-Check-in & Meldeschein» an ist
  const reg = isOn(rows, "guests") ? new Map((await checkinStatus(hotel.id, v.day)).map((a) => [a.bookingId, { registered: a.registered, verified: a.verified }])) : undefined;
  // Hinweis auf den Bereich Gastronomie (SPEC 20.1)
  const dining = isOn(rows, "restaurant") && hasArea(role, "dininghome") ? await (async () => {
    const live = (await reservationsOfDay(hotel.id, todayIn(hotel.timezone))).filter((r) => r.status === "confirmed" || r.status === "seated");
    return { label: DINING_LABEL[hotel.diningLabel]?.de ?? "Restaurant", n: live.length, guests: live.reduce((a, r) => a + r.party, 0) };
  })() : null;
  const noData = isToday && !v.notices.length && !v.arrivals.length && !v.departures.length && !v.inHouse.length && !v.balances?.length && !v.overdue?.length;
  return (
    <div className="stack">
      <h1 className="sr-only">Tagesliste</h1>
      <PeriodNav prev={`${base}?day=${addDays(v.day, -1)}`} next={`${base}?day=${addDays(v.day, 1)}`} todayHref={base} todayActive={isToday} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: v.day, param: "day" }}>
        {showPlan ? <a className="btn secondary small" href={`${base}/plan`}>Zimmerplan</a> : null}
      </PeriodNav>
      <p className="day-line">{isToday ? "Heute, " : ""}{formatDay(v.day, "de")}</p>
      {dining ? <a className="notice" href={`${base}/restaurant/heute`} style={{ display: "block", textDecoration: "none", color: "inherit" }} data-testid="dining-hint">{dining.label} heute: {dining.n} Reservationen, {dining.guests} Gäste <strong>→</strong></a> : null}

      {v.notices.length ? (
        <section className="stack" aria-label="Hinweise">
          {v.notices.map((n) => (
            <a key={n.key} href={n.href} className={`notice${n.tone === "warn" ? " warn" : ""}`} style={{ display: "block", textDecoration: "none", color: "inherit" }}>{n.text} <strong>→</strong></a>
          ))}
        </section>
      ) : null}

      <List title={isToday ? "Anreisen heute" : "Anreisen"} rows={v.arrivals} hotelId={hotel.id} empty="Keine Anreisen." reg={reg} day={v.day} />
      <List title={isToday ? "Abreisen heute" : "Abreisen"} rows={v.departures} hotelId={hotel.id} empty="Keine Abreisen." />
      <List title="Im Haus" rows={v.inHouse} hotelId={hotel.id} empty="Niemand im Haus." />

      {v.balances?.length || v.overdue?.length ? (
        <section className="card stack">
          <h2 className="m0">Offene Zahlungen</h2>
          {v.balances?.length ? (
            <>
              <h3 className="m0">Restzahlungen für laufende und bald beginnende Aufenthalte</h3>
              <ul className="list">
                {v.balances.map((b) => <li key={b.bookingId}><a href={`${base}/bookings/${b.bookingId}`}><strong>{b.guest}</strong></a> <span className="muted small">· {b.reference} · Anreise {formatDay(b.checkin, "de")}</span> · {formatChf(b.amountRappen)}</li>)}
              </ul>
            </>
          ) : null}
          {v.overdue?.length ? (
            <>
              <h3 className="m0">Überfällige Rechnungen</h3>
              <ul className="list">
                {v.overdue.map((i) => <li key={i.id}><strong>{i.number}</strong> <span className="muted small">· {i.payer} · {i.daysOverdue} Tage überfällig</span> · {formatChf(i.openRappen)}</li>)}
              </ul>
              <p className="small m0"><a href={`${base}/invoices`}>Zu den Rechnungen</a></p>
            </>
          ) : null}
        </section>
      ) : null}

      {noData ? <p className="muted">Heute ist nichts offen.</p> : null}
    </div>
  );
}
