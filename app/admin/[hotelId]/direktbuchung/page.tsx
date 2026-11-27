import { Notice } from "@/components/admin/Notice";
import Link from "next/link";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { LangTabs } from "@/components/admin/LangTabs";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotel } from "@/src/auth/guard";
import { hotelLocales, formatDay, LOCALE_NAMES, type Locale } from "@/src/i18n/dict";
import { gapSettings, MAX_BENEFITS, MAX_GAP_NIGHTS, recoveryEnabled, waitlistEnabled, winbackSettings, WINBACK_MAX_DAYS, WINBACK_MIN_DAYS, type Benefit } from "@/src/domain/direct-tools";
import { moduleOn } from "@/src/services/modules";
import { listCompanies } from "@/src/services/debtors";
import { cancelWaitlistEntry, deleteCode, listCodes, listGaps, listWaitlist, saveCode, saveDirectSettings } from "@/src/services/direct-tools";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";

const run = (f: FormData, ok: string, fn: (c: HotelCtx) => Promise<unknown>, anchor = "") =>
  hotelAction(f, { page: "direktbuchung", role: "manager", ok, anchor }, async (c) => { await fn(c); });

async function benefitsSave(f: FormData) {
  "use server";
  await run(f, "Direktvorteile gespeichert", ({ hotel, actor }) => {
    const langs = hotelLocales(hotel);
    const items = Array.from({ length: MAX_BENEFITS }, (_, i) => ({
      id: `b${i + 1}`,
      text: Object.fromEntries(langs.map((l) => [l, s(f, `text_${i}_${l}`)])) as Partial<Record<Locale, string>>,
      minNights: Number(s(f, `min_${i}`)) || undefined,
    }));
    return saveDirectSettings(hotel.id, { benefits: { enabled: f.get("enabled") === "on", items } }, actor);
  }, "#vorteile");
}
async function gapsSave(f: FormData) {
  "use server";
  await run(f, "Lückenfüller gespeichert", ({ hotel, actor }) =>
    saveDirectSettings(hotel.id, { gaps: { enabled: f.get("enabled") === "on", maxNights: Number(s(f, "maxNights")) || 2, discountBps: Math.round((Number(s(f, "discount").replace(",", ".")) || 0) * 100), relaxMinStay: f.get("relax") === "on" } }, actor), "#luecken");
}
async function toggleSave(f: FormData) {
  "use server";
  await run(f, "Gespeichert", ({ hotel, actor }) =>
    saveDirectSettings(hotel.id, s(f, "what") === "recovery" ? { recovery: { enabled: f.get("enabled") === "on" } } : { waitlist: { enabled: f.get("enabled") === "on" } }, actor), `#${s(f, "what") === "recovery" ? "abbruch" : "warteliste"}`);
}
async function winbackSave(f: FormData) {
  "use server";
  await run(f, "Gespeichert", ({ hotel, actor }) =>
    saveDirectSettings(hotel.id, { winback: { enabled: f.get("enabled") === "on", afterDays: Number(s(f, "days")) || undefined } }, actor), "#wiederkehr");
}
async function codeSave(f: FormData) {
  "use server";
  const id = s(f, "codeId") || null;
  await hotelAction(f, { page: "direktbuchung", role: "manager", ok: id ? "Code gespeichert" : "Code angelegt", anchor: "#codes", reopen: { code: id ?? "neu" } }, async ({ hotel, actor }) => {
    await saveCode(hotel.id, id, { companyId: s(f, "companyId"), code: s(f, "code"), discountPct: Number(s(f, "discount").replace(",", ".")) || 0, payOnInvoice: f.get("invoice") === "on", validFrom: s(f, "from") || null, validUntil: s(f, "until") || null, active: id ? f.get("active") === "on" : true }, actor);
  });
}
async function codeDelete(f: FormData) {
  "use server";
  await run(f, "Code gelöscht", ({ hotel, actor }) => deleteCode(hotel.id, s(f, "codeId"), actor), "#codes");
}
async function waitCancel(f: FormData) {
  "use server";
  await run(f, "Eintrag entfernt", ({ hotel, actor }) => cancelWaitlistEntry(hotel.id, s(f, "entryId"), actor), "#warteliste");
}

const STATUS: Record<string, string> = { waiting: "wartet", notified: "benachrichtigt", cancelled: "abgemeldet", expired: "abgelaufen" };

/** Direktbuchung: Vorteile, Firmencodes, Lückenfüller, Warteliste, Abbruch-Mail (SPEC 19.29). Manager und Inhaber. */
export default async function Direktbuchung({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const d = hotel.content.direct;
  const langs = hotelLocales(hotel);
  const items: (Benefit | undefined)[] = Array.from({ length: MAX_BENEFITS }, (_, i) => d?.benefits?.items?.[i]);
  const gaps = gapSettings(d);
  const debtors = await moduleOn(hotel.id, "debtors");
  const [codes, companies, gapList, waiting] = await Promise.all([debtors ? listCodes(hotel.id) : [], debtors ? listCompanies(hotel.id, true) : [], listGaps(hotel), listWaitlist(hotel.id)]);

  const editCode = sp.code === "neu" ? null : codes.find((c) => c.id === sp.code) ?? null;
  const codeDrawer = debtors && (sp.code === "neu" ? companies.length > 0 : !!editCode);
  const close = "/admin/" + hotel.id + "/direktbuchung#codes";
  return (
    <div className="stack">
      {codeDrawer ? (
        <Drawer title={editCode ? `Code ${editCode.code}` : "Neuer Firmencode"} closeHref={close}>
          {sp.msg ? <Notice text={sp.msg} /> : null}
          <form action={codeSave} className="stack">
            {hidden}
            {editCode ? <><input type="hidden" name="codeId" value={editCode.id} /><input type="hidden" name="companyId" value={editCode.companyId} /><p className="m0"><strong>{editCode.companyName}</strong> · {editCode.used} Buchungen</p></> : (
              <div><label htmlFor="dc-company">Firma</label><select id="dc-company" name="companyId" required>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            )}
            <div className="form-grid">
              <div><label htmlFor="dc-code">{editCode ? "Code" : "Code (leer = wird erzeugt)"}</label><input className="upper" id="dc-code" name="code" maxLength={24} defaultValue={editCode?.code ?? ""} /></div>
              <div><label htmlFor="dc-discount">Rabatt %</label><input id="dc-discount" name="discount" type="number" min={0} max={50} step="0.5" defaultValue={editCode ? editCode.discountBps / 100 : 10} /></div>
              <div><label htmlFor="dc-from">Gültig ab (Anreise)</label><input id="dc-from" name="from" type="date" defaultValue={editCode?.validFrom ?? ""} /></div>
              <div><label htmlFor="dc-until">bis</label><input id="dc-until" name="until" type="date" defaultValue={editCode?.validUntil ?? ""} /></div>
            </div>
            <label className="check"><input type="checkbox" name="invoice" defaultChecked={editCode?.payOnInvoice ?? false} /> Auf Rechnung buchen (keine Kartenzahlung)</label>
            {editCode ? <label className="check"><input type="checkbox" name="active" defaultChecked={editCode.active} /> Aktiv</label> : null}
            <DrawerActions submit={editCode ? "Speichern" : "Code anlegen"} cancelHref={close} />
          </form>
          {editCode ? <form action={codeDelete}>{hidden}<input type="hidden" name="codeId" value={editCode.id} /><ConfirmButton ask={`Code «${editCode.code}» wirklich löschen?`} className="btn secondary small danger-text">Löschen</ConfirmButton></form> : null}
        </Drawer>
      ) : null}
      <h1>Direktbuchung<InfoTip>Werkzeuge, die mehr Gäste zur Direktbuchung bringen und freie Nächte füllen. Alles ist je Betrieb ein- und ausschaltbar.</InfoTip></h1>
      {sp.msg && !codeDrawer ? <Notice text={sp.msg} /> : null}

      <section className="card stack" id="vorteile">
        <h2>Vorteile bei Direktbuchung</h2>
        <p className="muted small m0">Kurze Zusagen, die Gäste im Buchungsfenster und in der Bestätigung sehen, zum Beispiel «Late Check-out bis 14 Uhr» oder «Willkommensgetränk». Der Preis bleibt gleich wie auf den Portalen, deshalb ist das mit deren Preisregeln vereinbar. Nur versprechen, was Sie halten.</p>
        <form action={benefitsSave} className="stack">
          {hidden}
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={d?.benefits?.enabled === true} /> Vorteile im Buchungsfenster anzeigen</label>
          {langs.length > 1 ? <><LangTabs langs={langs.filter((l) => l !== "de").map((l) => ({ code: l, name: LOCALE_NAMES[l] }))} /><p className="muted small m0">Fehlt eine Sprache, sehen Gäste Englisch oder Deutsch.</p></> : null}
          {items.map((b, i) => (
            <div key={i} className="stack gap6">
              <div className="row">
                <div style={{ flex: "1 1 320px" }}><label htmlFor={`db-text_${i}_de`}>Vorteil {i + 1} (Deutsch)</label><input id={`db-text_${i}_de`} name={`text_${i}_de`} defaultValue={b?.text.de ?? ""} maxLength={90} placeholder={i === 0 ? "z. B. Late Check-out bis 14 Uhr" : ""} /></div>
                <div style={{ width: 150 }}><label htmlFor={`fbe24m1-${i}`}>ab Nächten</label><input id={`fbe24m1-${i}`} name={`min_${i}`} type="number" min={1} max={30} defaultValue={b?.minNights ?? ""} placeholder="alle" /></div>
              </div>
              {langs.filter((l) => l !== "de").map((l) => (
                <div key={l} data-lang={l} hidden={l !== langs.filter((x) => x !== "de")[0]}><label htmlFor={`db-text_${i}_${l}`}>Vorteil {i + 1} ({LOCALE_NAMES[l]})</label><input id={`db-text_${i}_${l}`} name={`text_${i}_${l}`} defaultValue={b?.text[l] ?? ""} maxLength={90} /></div>
              ))}
            </div>
          ))}
          <div><button className="btn">Speichern</button></div>
        </form>
      </section>

      <section className="card stack" id="codes">
        <h2>Firmencodes</h2>
        {!debtors ? (
          <p className="muted small m0">Firmencodes gehören zu den Firmenkunden. Schalten Sie unter <a href={`/admin/${hotel.id}/funktionen`}>Einstellungen → Funktionen</a> das Modul «Debitoren» ein, dann legen Sie hier Codes an.</p>
        ) : (
          <>
            <p className="muted small m0">Eine Firma bucht mit ihrem Code Ihr günstigeres Firmenpreis-Angebot direkt auf Ihrer Seite. Mit «auf Rechnung» ist die Buchung sofort bestätigt und die Rechnung geht an die Firma (siehe Debitoren). Das Feld «Code» erscheint im Buchungsfenster, sobald es einen aktiven Code gibt.</p>
            {codes.length ? (
              <table className="table">
                <thead><tr><th>Firma</th><th>Code</th><th>Rabatt</th><th>Rechnung</th><th>Gültig (Anreise)</th><th>Buchungen</th><th></th></tr></thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.companyName}{c.active ? "" : <span className="muted small"> (aus)</span>}</td>
                      <td><code>{c.code}</code></td>
                      <td>{c.discountBps / 100} %</td>
                      <td>{c.payOnInvoice ? "ja" : "nein"}</td>
                      <td className="small">{c.validFrom ? formatDay(c.validFrom, "de") : "–"} bis {c.validUntil ? formatDay(c.validUntil, "de") : "–"}</td>
                      <td>{c.used}</td>
                      <td><Link className="btn secondary small" href={`?code=${c.id}#codes`} scroll={false}>Bearbeiten</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Noch kein Code angelegt. Mit «+ Neuer Code» legen Sie den ersten an.</p>}
            {companies.length ? (
              <div><Link className="btn secondary" href="?code=neu#codes" scroll={false}>+ Neuer Code</Link></div>
            ) : <p className="muted small m0">Legen Sie zuerst unter <a href={`/admin/${hotel.id}/invoices/debitoren`}>Finanzen → Debitoren</a> eine Firma an.</p>}
          </>
        )}
      </section>

      <section className="card stack" id="luecken">
        <h2>Lückenfüller</h2>
        <p className="muted small m0">Eine Lücke sind ein bis drei freie Nächte zwischen zwei ausgebuchten Nächten eines Zimmertyps. Wer genau diese Lücke bucht, darf den Mindestaufenthalt unterschreiten und bekommt auf Wunsch einen Rabatt. Das gilt nur für Direktbuchungen; Portale bekommen weiterhin Ihre normalen Regeln.</p>
        <form action={gapsSave} className="stack">
          {hidden}
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={gaps.enabled} /> Lückenfüller einschalten</label>
          <div className="row">
            <div><label htmlFor="fbe246">Lücke höchstens</label><select id="fbe246" name="maxNights" defaultValue={gaps.maxNights}>{Array.from({ length: MAX_GAP_NIGHTS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "Nacht" : "Nächte"}</option>)}</select></div>
            <div><label htmlFor="fbe247">Rabatt %</label><input id="fbe247" name="discount" type="number" min={0} max={30} step="0.5" defaultValue={gaps.discountBps / 100} /></div>
          </div>
          <label className="check"><input type="checkbox" name="relax" defaultChecked={gaps.relaxMinStay} /> Mindestaufenthalt in der Lücke aufheben</label>
          <div><button className="btn">Speichern</button></div>
        </form>
        <h3 style={{ margin: "8px 0 0" }}>Aktuelle Lücken (nächste 180 Tage)</h3>
        {gapList.length ? (
          <table className="table"><thead><tr><th>Zimmertyp</th><th>Von</th><th>Bis (Abreise)</th><th>Nächte</th></tr></thead>
            <tbody>{gapList.slice(0, 40).map((g) => <tr key={`${g.roomTypeId}${g.from}`}><td>{g.roomTypeName}</td><td>{formatDay(g.from, "de")}</td><td>{formatDay(g.to, "de")}</td><td>{g.nights}</td></tr>)}</tbody></table>
        ) : <p className="muted">Zurzeit keine Lücken von höchstens {gaps.maxNights} {gaps.maxNights === 1 ? "Nacht" : "Nächten"}.</p>}
        {gapList.length > 40 ? <p className="muted small">Es werden die ersten 40 gezeigt.</p> : null}
      </section>

      <section className="card stack" id="warteliste">
        <h2>Warteliste</h2>
        <p className="muted small m0">Ist für die gesuchten Daten alles ausgebucht, kann sich der Gast eintragen. Wird etwas frei (Stornierung, abgelaufene Reservation), erhält er einmalig eine Mail mit Link zur Buchung. Wer zuerst bucht, bekommt das Zimmer.</p>
        <form action={toggleSave} className="inline-form">
          {hidden}<input type="hidden" name="what" value="waitlist" />
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={waitlistEnabled(d)} /> Warteliste anbieten</label>
          <button className="btn secondary small">Speichern</button>
        </form>
        {waiting.length ? (
          <table className="table"><thead><tr><th>Gast</th><th>Daten</th><th>Personen</th><th>Stand</th><th></th></tr></thead>
            <tbody>{waiting.slice(0, 50).map((w) => (
              <tr key={w.id}><td>{w.name ? `${w.name}, ` : ""}{w.email}</td><td className="small">{formatDay(w.checkin, "de")} – {formatDay(w.checkout, "de")}</td><td>{w.adults}{w.children ? ` + ${w.children}` : ""}</td><td>{STATUS[w.status] ?? w.status}</td>
                <td>{w.status === "waiting" ? <form action={waitCancel}>{hidden}<input type="hidden" name="entryId" value={w.id} /><button className="btn secondary small">Entfernen</button></form> : null}</td></tr>
            ))}</tbody></table>
        ) : <p className="muted">Niemand wartet.</p>}
      </section>

      <section className="card stack" id="abbruch">
        <h2>Erinnerung nach abgebrochener Buchung</h2>
        <p className="muted small m0">Hat ein Gast seine Daten eingegeben, aber nicht bezahlt, geht ihm etwa eine Stunde später einmalig eine Mail mit Link zurück zur Suche. Keine weitere Mail dazu. Nicht gesendet wird, wenn er inzwischen gebucht hat oder nichts mehr frei ist. Standardmässig aus: Bitte prüfen Sie mit Ihrer Datenschutzerklärung, dass Sie das so wollen (Vertragsanbahnung auf Wunsch des Gastes).</p>
        <form action={toggleSave} className="inline-form">
          {hidden}<input type="hidden" name="what" value="recovery" />
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={recoveryEnabled(d)} /> Erinnerung senden</label>
          <button className="btn secondary small">Speichern</button>
        </form>
      </section>

      <section className="card stack" id="wiederkehr">
        <h2>Wiederkehr-Mail</h2>
        <p className="muted small m0">Rund ein Jahr nach dem Aufenthalt geht Gästen, die direkt gebucht und dem Erhalt von Angeboten zugestimmt haben, einmalig eine Einladung zu: mit ihren Daten vom letzten Mal, einem Link zur Buchung und Abmelde-Link. Wer sich abmeldet, bekommt nichts mehr. Es gibt höchstens eine Mail pro Adresse in 300 Tagen, und keine, wenn der Gast schon wieder gebucht hat. Standardmässig aus.</p>
        <form action={winbackSave} className="inline-form">
          {hidden}
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={winbackSettings(d).enabled} /> Einladung senden</label>
          <label>Tage nach der Abreise <input name="days" type="number" min={WINBACK_MIN_DAYS} max={WINBACK_MAX_DAYS} defaultValue={winbackSettings(d).afterDays} className="w90" /></label>
          <button className="btn secondary small">Speichern</button>
        </form>
      </section>
    </div>
  );
}
