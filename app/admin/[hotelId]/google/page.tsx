import { Notice } from "@/components/admin/Notice";
import { CopyBox } from "@/components/admin/CopyBox";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotelModule } from "@/src/auth/guard";
import { googleOverview, requestHotelLinks, saveGoogleDining } from "@/src/services/google";
import { hotelAction } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";

const run = (f: FormData, fn: Parameters<typeof hotelAction>[2]) => hotelAction(f, { page: "google", module: "google", role: "manager", fail: "Nicht möglich" }, fn);

async function requestLinks(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => { await requestHotelLinks(hotel, actor); return "Anfrage gesendet. Pontivo schaltet Google im Channel-Manager frei und meldet sich."; });
}
async function dining(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => { await saveGoogleDining(hotel, { reserve: f.get("reserve") === "on", order: f.get("order") === "on" }, actor); return "Gespeichert."; });
}

const WHERE: Record<string, string> = { site: "site", settings: "settings", rooms: "rooms", channex: "channex" };
const LINKS_STATUS = { off: "nicht angefragt", requested: "angefragt, wird freigeschaltet", active: "aktiv" } as const;

/** Google (SPEC 19.67): Unternehmensprofil, kostenlose Buchungslinks (Unterkunft), Reservieren und Bestellen mit Google (Restaurant) */
export default async function GooglePage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("google", hotelId, "manager");
  const o = await googleOverview(hotel);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const base = `/admin/${hotel.id}`;
  const total = o.last30.bookings + o.last30.reservations + o.last30.orders;
  return (
    <div className="stack">
      <h1>Google</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Viele Gäste suchen Ihren Betrieb direkt bei Google. Mit den Links unten landen sie auf Ihrer eigenen Buchung, Reservation oder Bestellung statt bei einem Portal. Buchungen, die über Google kommen, sehen Sie in der Statistik als «Direkt über Google».</InfoTip></div>
      <p className="muted" data-testid="google-last30">Über Google gekommen (letzte 30 Tage): {total ? `${o.lodging ? `${o.last30.bookings} Buchungen, ` : ""}${o.last30.reservations} Reservationen, ${o.last30.orders} Bestellungen` : "noch nichts"}.</p>

      <section className="card stack" data-testid="google-profile">
        <h2 className="m0">1. Google-Unternehmensprofil</h2>
        <p className="muted small m0">Im Unternehmensprofil (business.google.com) unter «Bearbeiten» die Links eintragen. Google zeigt dann Knöpfe wie «Buchen», «Reservieren» oder «Online bestellen». Das ist kostenlos und in wenigen Minuten erledigt.</p>
        <ol className="help-steps">
          <li>business.google.com öffnen und Ihren Betrieb wählen (bei Bedarf zuerst bestätigen lassen).</li>
          <li>«Unternehmensprofil bearbeiten» → «Kontakt»: bei «Website» die erste Adresse unten einfügen.</li>
          <li>Unter «Buchungen» bzw. «Reservierungen» und «Bestellungen» die passenden Links einfügen.</li>
        </ol>
        <div><p className="small m0"><strong>Website</strong></p><CopyBox label="Website" text={o.links.website} /></div>
        {o.links.book ? <div><p className="small m0"><strong>Buchen (Zimmer)</strong></p><CopyBox label="Buchen (Zimmer)" text={o.links.book} /></div> : null}
        {o.links.reserve ? <div><p className="small m0"><strong>Tisch reservieren</strong></p><CopyBox label="Tisch reservieren" text={o.links.reserve} /></div> : null}
        {o.links.order ? <div><p className="small m0"><strong>Online bestellen</strong></p><CopyBox label="Online bestellen" text={o.links.order} /></div> : null}
        {!o.lodging && !o.links.reserve ? <p className="small muted m0">Reservieren erscheint hier, sobald die <a href={`${base}/restaurant/einstellungen`}>Online-Reservation</a> eingeschaltet ist.</p> : null}
      </section>

      {o.lodging ? (
        <section className="card stack" data-testid="google-hotel-links">
          <h2 className="m0">2. Kostenlose Buchungslinks</h2>
          <p className="muted small m0">Google zeigt in der Hotelsuche neben den Portalen auch Ihren eigenen Preis mit Link zu Ihrer Buchung, ohne Provision. Zimmer und Preise gehen über den Channel-Manager an Google. Google prüft neue Häuser etwa einmal pro Woche.</p>
          <p className="m0">Status: <strong>{LINKS_STATUS[o.settings.hotelLinks]}</strong></p>
          <ul className="ready-list">
            {o.checklist.map((c) => (
              <li key={c.key} className={c.ok ? "done" : ""}>
                <span className="dot" aria-hidden="true">{c.ok ? "✓" : ""}</span>
                <span className="ready-text">{c.ok ? <span className="muted">{c.text}</span> : <a href={`${base}/${WHERE[c.where]}`}>{c.text}</a>}</span>
              </li>
            ))}
          </ul>
          {o.settings.hotelLinks === "off" ? (
            <form action={requestLinks}>{H}<button className="btn" disabled={o.checklist.some((c) => !c.ok)}>Kostenlose Buchungslinks anfragen</button></form>
          ) : null}
          {o.links.bookTemplate ? <details className="small"><summary>Buchungslink für den Channel-Manager</summary><p className="muted">Channex ersetzt die Platzhalter beim Klick aus Google durch die gesuchten Daten.</p><div><p className="small m0"><strong>Buchungslink mit Platzhaltern</strong></p><CopyBox label="Buchungslink mit Platzhaltern" text={o.links.bookTemplate} /></div></details> : null}
        </section>
      ) : null}

      {o.restaurant ? <form action={dining} className="card stack" data-testid="google-dining">{H}
        <h2 className="m0">{o.lodging ? "3." : "2."} Reservieren und Bestellen mit Google</h2>
        <p className="muted small m0">Pontivo meldet Ihren Betrieb im Google Actions Center an. Dann erscheinen in Google Suche und Maps die Knöpfe «Tisch reservieren» und «Online bestellen» mit Link zu Ihrer Seite.</p>
        <FormSwitch name="reserve" defaultOn={o.settings.reserve} label="Tisch reservieren über Google" hint={o.dining.reserveOnline ? "Link zu Ihrer Online-Reservation." : "Braucht die eingeschaltete Online-Reservation."} />
        <FormSwitch name="order" defaultOn={o.settings.order} label="Online bestellen über Google" hint={o.dining.orderOnline ? "Link zu Ihrer Online-Bestellung (Abholung und Lieferung)." : "Braucht die live geschaltete Online-Bestellung."} />
        <div><button className="btn">Speichern</button></div>
      </form> : null}
    </div>
  );
}
