import type { Hotel } from "@/src/db/schema";
import { formatDay, type Locale } from "@/src/i18n/dict";
import { RES } from "@/src/i18n/reservation";
import { addDays, todayIn } from "@/src/domain/dates";
import { getSettings, reservationByToken, slotsFor, tableReservationOnline } from "@/src/services/reservations";
import { Shell } from "./Shell";
import { env } from "@/src/env";
import { AutoRefresh } from "./AutoRefresh";
import { depositFor } from "@/src/domain/reservations";
import { formatChf } from "@/src/domain/money";
import { cancelReservationAction, reserveAction, waitlistAction } from "./table-actions";
import { PRE } from "@/src/i18n/preorder";
import { onlineMenu } from "@/src/services/online-orders";

/** Öffentliche Tischreservierung (SPEC 19.49 Etappe C): Datum und Personen wählen, freie Zeiten, Daten, Bestätigung */
export async function TablePage({ hotel, locale, base, sp }: { hotel: Hotel; locale: Locale; base: string; sp: Record<string, string | string[] | undefined> }) {
  const r = RES[locale];
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const settings = { ...(await getSettings(hotel.id)) };
  settings.onlineEnabled = await tableReservationOnline(hotel.id); // ohne Modul «restaurant» keine Online-Reservierung
  // Anzahlung nur, wenn Stripe Zahlungen freigegeben hat (sonst wird ohne Anzahlung reserviert)
  if (env().PAYMENT_PROVIDER === "stripe" && !(hotel.stripeAccountId && hotel.stripeChargesEnabled)) settings.depositPerPersonRappen = 0;
  const today = todayIn(hotel.timezone);
  const day = one("date") ?? "";
  const party = Math.max(1, Math.min(50, Number(one("party")) || 2));
  const slots = settings.onlineEnabled && day ? (await slotsFor(hotel, day, party)).filter((x) => x.ok) : null;
  const stripeOk = env().PAYMENT_PROVIDER !== "stripe" || !!(hotel.stripeAccountId && hotel.stripeChargesEnabled);
  const pre = PRE[locale];
  // Vorbestellung (SPEC 19.57): Artikel ohne Pflicht-Optionen, die online bestellbar sind
  const menu = settings.preorderEnabled && stripeOk && slots ? (await onlineMenu(hotel.id)).filter((x) => !x.groups.some((g) => g.required)) : [];
  const preRequired = !!settings.preorderEnabled && !!settings.preorderRequiredFrom && party >= settings.preorderRequiredFrom;
  const cats = [...new Set(menu.map((x) => x.category))];
  return (
    <Shell hotel={hotel} locale={locale} base={base} path="/tisch">
      <section className="stack pad32-560">
        <h1>{r.title}</h1>
        {!settings.onlineEnabled ? <p className="notice warn">{r.off}</p> : (
          <>
            {one("msg") ? <p className="notice error" role="alert">{one("msg")}</p> : null}
            <form method="get" className="stack">
              <div><label htmlFor="date">{r.date}</label><input id="date" name="date" type="date" min={today} max={addDays(today, settings.horizonDays)} defaultValue={day} required /></div>
              <div><label htmlFor="party">{r.guests}</label><input id="party" name="party" type="number" min={1} max={50} defaultValue={party} required /></div>
              <div><button className="btn secondary">{r.show}</button></div>
            </form>
            {party > settings.maxParty ? <p className="notice warn">{r.callUs}</p> : null}
            {slots && party <= settings.maxParty ? (
              slots.length ? (
                <form action={reserveAction} className="stack" data-testid="reserve-form">
                  <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="base" value={base} />
                  <input type="hidden" name="day" value={day} /><input type="hidden" name="party" value={party} />
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
                  <fieldset className="stack"><legend><strong>{r.times}</strong> · {formatDay(day, locale)}</legend>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {slots.map((x, n) => <label key={x.time} className="btn secondary"><input type="radio" name="time" value={x.time} required defaultChecked={n === 0} /> {x.time}</label>)}
                    </div>
                  </fieldset>
                  <div><label htmlFor="name">{r.name}</label><input id="name" name="name" required maxLength={80} autoComplete="name" /></div>
                  <div><label htmlFor="email">{r.email}</label><input id="email" name="email" type="email" maxLength={200} autoComplete="email" /></div>
                  <div><label htmlFor="phone">{r.phone}</label><input id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" /></div>
                  <p className="small muted">{r.contact}</p>
                  <div><label htmlFor="note">{r.note}</label><input id="note" name="note" maxLength={300} /></div>
                  {menu.length ? (
                    <fieldset className="stack" data-testid="preorder"><legend><strong>{pre.title}</strong></legend>
                      <p className="small muted m0">{pre.hint()}</p>
                      {preRequired ? <p className="notice small">{pre.required(settings.preorderRequiredFrom!)}</p> : null}
                      {cats.map((c) => (
                        <div key={c} className="stack"><strong className="small">{c}</strong>
                          {menu.filter((x) => x.category === c).map((x) => (
                            <div key={x.id} className="tq-line"><label htmlFor={`p_${x.id}`}>{x.name}</label><span className="small muted">{formatChf(x.priceRappen)}</span><input id={`p_${x.id}`} name={`p_${x.id}`} type="number" min={0} max={50} defaultValue={0} aria-label={`${pre.qty}: ${x.name}`} /></div>
                          ))}
                        </div>
                      ))}
                    </fieldset>
                  ) : null}
                  {!menu.length && depositFor(settings, party) ? <p className="notice small">{r.deposit(formatChf(depositFor(settings, party)))}</p> : null}
                  <div><button className="btn">{r.book}</button></div>
                </form>
              ) : (
                <div className="stack">
                  <p className="notice warn">{r.none}</p>
                  {one("wait") ? <p className="notice">{r.waitDone}</p> : (
                    <form action={waitlistAction} className="card stack" data-testid="waitlist-form">
                      <h2>{r.wait}</h2>
                      <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="base" value={base} />
                      <input type="hidden" name="day" value={day} /><input type="hidden" name="party" value={party} />
                      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
                      <div><label htmlFor="wname">{r.name}</label><input id="wname" name="name" required maxLength={80} autoComplete="name" /></div>
                      <div><label htmlFor="wemail">{r.email}</label><input id="wemail" name="email" type="email" required maxLength={200} autoComplete="email" /></div>
                      <div><button className="btn secondary">{r.waitSend}</button></div>
                    </form>
                  )}
                </div>
              )
            ) : null}
          </>
        )}
      </section>
    </Shell>
  );
}

/** Bestätigung und Storno über den Link aus der Mail */
export async function TableTokenPage({ hotel, locale, base, token, sp }: { hotel: Hotel; locale: Locale; base: string; token: string; sp: Record<string, string | string[] | undefined> }) {
  const r = RES[locale];
  const res = await reservationByToken(token);
  const mine = res && res.hotelId === hotel.id ? res : null;
  return (
    <Shell hotel={hotel} locale={locale} base={base} path="/tisch">
      <section className="stack pad32-560">
        {!mine ? <><h1>{r.title}</h1><p className="notice warn">{r.cancelled}</p></> : (
          <>
            {mine.status === "pending" ? <AutoRefresh seconds={5} /> : null}
            <h1>{sp.cancelled ? r.cancelDone : mine.status === "cancelled" ? r.cancelled : mine.status === "pending" ? r.title : sp.new ? r.booked : r.title}</h1>
            {mine.status === "pending" ? <p className="notice">{r.pending}</p> : null}
            <p><strong>{r.when}:</strong> {formatDay(mine.day, locale)}, {mine.time} · {mine.party} {r.guests}</p>
            <p>{mine.name}</p>
            {mine.status === "cancelled" && mine.depositStatus === "refunded" ? <p className="notice">{r.refunded}</p> : null}
            {mine.status === "cancelled" && mine.depositStatus === "paid" ? <p className="notice warn">{r.kept}</p> : null}
            {mine.status === "confirmed" ? (
              <form action={cancelReservationAction}><input type="hidden" name="token" value={token} /><input type="hidden" name="locale" value={locale} /><input type="hidden" name="base" value={base} /><button className="btn secondary">{r.cancel}</button></form>
            ) : null}
          </>
        )}
      </section>
    </Shell>
  );
}
