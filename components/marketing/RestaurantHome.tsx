import s from "./marketing.module.css";
import { ContactBlock, Faq, MarketingShell, mailHref, type ShellContact } from "./Shell";
import { pageHref } from "./PontivoHome";

// Rechenbeispiel (Texte-Dokument Abschnitt 3): 400 Bestellungen à CHF 35 = CHF 14'000 Bestellumsatz
const ORDERS = 400;
const AVG = 35;
const TURNOVER = ORDERS * AVG;
const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");

/** Ende des Bestellsystems, das viele Restaurants heute nutzen; danach verschwindet der Abschnitt von selbst */
const SWITCH_UNTIL = "2027-04-30";

/**
 * Seite für Restaurants (SPEC 20.9, Texte: Claude Docs «Pontivo Website-Texte», Abschnitt 3).
 * Preise nach Restaurant-Konzept Abschnitt 6 (Anzahlung für Tischreservation gebührenfrei, Entscheid 21.11.2026).
 */
export function RestaurantHome({ contact, account, fee, feeBps, minimum, today, introRappen, introMonths, pilot }: {
  contact: ShellContact; account: { label: string } | null; fee: string; feeBps: number; minimum: string; today: string;
  /** Sonderangebot Online-Bestellung (SPEC 20.4): pauschal pro Monat in den ersten Monaten */ introRappen: number; introMonths: number;
  /** Pilotbetriebe: Kostendach pro Monat, Dauer; null = alle Plätze vergeben (Abschnitt verschwindet). Freie Plätze werden bewusst nicht angezeigt. */ pilot: { left: number; slots: number; capRappen: number; months: number } | null;
}) {
  const st = contact.staticSite;
  const talk = mailHref(contact, "Pontivo für unser Restaurant");
  const ours = (TURNOVER * feeBps) / 10_000;
  const intro = `CHF ${fmt(introRappen / 100)}`;
  const cap = pilot ? `CHF ${fmt(pilot.capRappen / 100)}` : "";
  const rows = [
    { label: "Lieferplattform, Restaurant liefert selbst (ca. 13 %)", cost: TURNOVER * 0.13, ours: false },
    { label: "Lieferplattform mit deren Kurieren (ca. 30 %)", cost: TURNOVER * 0.3, ours: false },
    { label: `${contact.name} (${fee} %)`, cost: ours, ours: true },
    ...(pilot ? [{ label: `${contact.name} als Pilotbetrieb (höchstens ${cap})`, cost: Math.min(ours, pilot.capRappen / 100), ours: true }] : []),
  ];
  const max = TURNOVER * 0.3;
  const blocks = [
    ["Website", "Ihre Restaurant-Website mit Speisekarte in mehreren Sprachen, Öffnungszeiten, Fotos und Allergenen. Oder Pontivo auf Ihrer bestehenden Seite."],
    ["Tischreservation", "Gäste reservieren rund um die Uhr. Erinnerung vor dem Besuch, Warteliste, auf Wunsch mit Anzahlung als Garantie gegen leere Tische."],
    ["Online-Bestellung", "Zum Abholen oder mit Lieferung: Gäste wählen aus Ihrer Karte, mit Extras und Abholzeit oder Lieferadresse, und bezahlen vorab mit TWINT oder Karte. Sie bekommen die Bestellung mit Alarm auf Tablet oder Handy."],
    ["Kasse", "Tische, Bestellungen, Getrennt-Zahlen, Trinkgeld, bar, Karte und TWINT. Unveränderbare Bons, Tagesabschluss, MWST für Restaurant und Take-away richtig getrennt. Funktioniert auch ohne Internet."],
  ];
  const prices = [
    ["Grundgebühr", `mindestens ${minimum} pro Monat`, "Website auf Wunsch, Tischreservation, Erinnerungen, Gästeliste"],
    ["Online-Bestellung", `${fee} % pro Bestellung`, `Abholung und Lieferung, Bestellbildschirm mit Alarm. Sonderangebot: die ersten ${introMonths} Monate pauschal ${intro} pro Monat, egal wie viele Bestellungen`],
    ["Online-Gutscheine", `${fee} % auf den bezahlten Betrag`, "Gutscheine auf Ihrer Website"],
    ["Anzahlung bei Reservation", "ohne Gebühr", "Schutz vor leeren Tischen"],
    ["Kasse", "CHF 29 pro Monat", "Kasse mit Bons, Tagesabschluss, offline-fähig; keine Gebühr von uns auf Kartenzahlungen im Lokal"],
    ["KI-Chat", "ab CHF 19 pro Monat", "Beantwortet Gastfragen auf Ihrer Website"],
  ];
  const faq = [
    { q: "Brauche ich alle vier Bausteine?", a: "Nein. Sie starten zum Beispiel nur mit der Reservation und schalten Bestellung oder Kasse später dazu. Ihre bisherige Kasse können Sie behalten." },
    { q: "Ist die Auslieferung mit dabei?", a: "Ja. Gäste wählen Abholung oder Lieferung. Sie liefern mit Ihren eigenen Fahrern in den Postleitzahlen-Gebieten, die Sie festlegen. Bar bei Lieferung können Sie erlauben oder ausschalten." },
    { q: "Brauche ich spezielle Geräte?", a: "Nein. Kasse und Bestellbildschirm laufen im Browser auf Tablet, Handy oder Computer." },
    { q: "Was passiert, wenn niemand eine Bestellung annimmt?", a: "Nach fünf Minuten kommt ein Alarm per SMS und Mail, nach zehn Minuten wird die Bestellung storniert und der Gast bekommt sein Geld zurück. Ist kein Bestellbildschirm erreichbar, pausiert die Online-Bestellung von selbst." },
    { q: "Was kostet die Online-Bestellung nach dem Sonderangebot?", a: `${fee} % pro Bestellung, abgezogen bei der Zahlung, bei Barzahlung mit der Monatsrechnung. Bei 400 Bestellungen à CHF 35 sind das CHF ${fmt(ours)} im Monat${pilot ? `, als Pilotbetrieb höchstens ${cap}` : ""}. Den Wechsel kündigen wir Ihnen vorher an, und Sie können monatlich kündigen.` },
    { q: "Was passiert, wenn das Internet ausfällt?", a: "Die Kasse arbeitet weiter und überträgt alles, sobald die Verbindung zurück ist." },
    { q: "Wem gehören die Gästedaten?", a: "Ihnen. Wir verkaufen keine Daten und betreiben keinen Marktplatz, auf dem Ihre Gäste zur Konkurrenz weitergeleitet werden." },
  ];
  return (
    <MarketingShell contact={contact} account={account} current="restaurant" tagline="Website, Reservation, Bestellung und Kasse für Schweizer Restaurants · Server und Datenbank bei Infomaniak in Genf" signupHref="/registrieren?art=restaurant">
      <section className={s.hero}>
        <div>
          <h1 className={s.heroTitle}>Website, Reservation, Bestellung und Kasse. Aus einer Hand.</h1>
          <p className={s.heroLead}>{contact.name} ist das System für Restaurants, Cafés und Take-aways in der Schweiz. Ihre Gäste reservieren und bestellen direkt bei Ihnen, bezahlen mit TWINT oder Karte, und an der Kasse läuft alles zusammen. Ohne Gebühr pro Gast.</p>
          <div className={s.heroActions}>
            {st ? <a className={s.btn} href={talk}>Gespräch vereinbaren</a> : (<>
              <a className={s.btn} href="/registrieren?art=restaurant">Jetzt loslegen</a>
            </>)}
            <a className={s.btnGhost} href="#preise">Preise ansehen</a>
          </div>
        </div>
        <figure className={s.receipt} aria-label={`Beispiel: ${ORDERS} Bestellungen pro Monat zu CHF ${AVG}`}>
          <div className={s.receiptHead}>
            <span className={s.receiptTitle}>{ORDERS} Bestellungen pro Monat</span>
            <span className={s.receiptSum}>CHF {fmt(TURNOVER)}</span>
          </div>
          {rows.map((r) => (
            <div key={r.label} className={s.row}>
              <div className={s.rowLabel}><span>{r.label}</span><span>Kosten <strong>CHF {fmt(r.cost)}</strong></span></div>
              <div className={s.bar} role="img" aria-label={`CHF ${fmt(r.cost)} pro Monat`}>
                <div className={r.ours ? s.keep : s.fee} style={{ width: `${Math.max(1.5, (r.cost / max) * 100)}%` }} />
              </div>
            </div>
          ))}
          <p className={s.receiptNote}>Rechenbeispiel: {ORDERS} Bestellungen zu durchschnittlich CHF {AVG}. Provisionssätze der Plattformen gerundet, gemäss <a href="https://www.beobachter.ch/wirtschaft/profitable-schattenwebsites-so-drangelt-sich-eatch-vor" target="_blank" rel="noopener">Beobachter</a>. Zahlungsgebühren fallen in allen Fällen an.</p>
        </figure>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>Statt vier Anbietern einer</h2>
        <p className={s.intro}>Ein Login, eine Rechnung, eine Gästeliste, und keine Daten, die zwischen Systemen verloren gehen.</p>
        <ul className={`${s.modGrid} ${s.modGrid2}`}>
          {blocks.map(([t, d]) => <li key={t} className={s.mod}><div><strong>{t}</strong><p>{d}</p></div></li>)}
        </ul>
        <p className={`${s.buildNote} u-mt-20px`}>Dazu auf Wunsch: <strong>Online-Gutscheine</strong>, die Sie auf Ihrer Website verkaufen, und ein <strong>KI-Chat</strong>, der Fragen zu Menü, Allergenen und Öffnungszeiten beantwortet, damit im Service weniger das Telefon klingelt.</p>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>Weil alles zusammenhängt</h2>
        <dl className={s.benefits}>
          {[
            ["Kein Abtippen", "Eine Online-Bestellung landet als Bon im Küchenbildschirm und in der Tagesabrechnung. Keine zweite Abrechnung."],
            ["Eine Karte", "Artikel und Preise pflegen Sie einmal. Sie gelten in der Kasse, in der Online-Bestellung und auf der Speisekarte der Website."],
            ["Ihre Gäste", "Ihre Gästeliste wächst aus Reservationen. Sie gehört Ihnen."],
            ["Hotel mit Restaurant", "Die Konsumation geht mit einem Klick auf die Zimmerrechnung."],
          ].map(([t, d]) => <div key={t} className={s.benefit}><dt>{t}</dt><dd>{d}</dd></div>)}
        </dl>
      </section>

      <section className={s.section} id="preise">
        <h2 className={s.h2}>Preise</h2>
        <div className={s.tableWrap}>
          <table className={s.priceTable}>
            <thead><tr><th>Leistung</th><th>Preis</th><th>Inhalt</th></tr></thead>
            <tbody>{prices.map(([a, b, c]) => <tr key={a}><td><strong>{a}</strong></td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>
        <p className={s.fieldHint}>Die {fee} % auf Bestellungen und Gutscheine werden an die Grundgebühr angerechnet: Kommen in einem Monat mehr als {minimum} Gebühren zusammen, zahlen Sie nur die {fee} %. Keine Gebühr pro Gast, keine Einrichtungsgebühr, monatlich kündbar, Bezahlung per Karte oder QR-Rechnung. Alle Preise ohne MWST, sofern geschuldet.</p>
      </section>

      <section className={s.section} id="angebot" data-testid="order-offer">
        <div className={s.price}>
          <div className={s.priceFig}>{intro.replace("CHF ", "")}</div>
          <div>
            <h2 className={s.h2}>Sonderangebot: {introMonths} Monate Online-Bestellung pauschal</h2>
            <p>Starten Sie ohne Rechnen: In den ersten {introMonths} Monaten ab dem Einschalten zahlen Sie für die Online-Bestellung pauschal {intro} pro Monat, egal wie viele Bestellungen hereinkommen. Danach gilt der Normalpreis von {fee} % pro Bestellung. Den Wechsel kündigen wir Ihnen vorher an.</p>
            {pilot ? (
              <p data-testid="order-pilot"><strong>Für die ersten {pilot.slots} Restaurants: Pilotbetrieb.</strong> Sie zahlen {pilot.months} Monate lang ab dem Start nie mehr als {cap} pro Monat für die Online-Bestellung, auch wenn Ihre {fee} % mehr ergäben. Dafür hören wir Ihnen zu: Ihre Rückmeldungen fliessen direkt in neue Funktionen.</p>
            ) : null}
            <p className={s.fieldHint}>Alle Einzelheiten: <a href={pageHref("/pilot-bedingungen", st)}>Pilotbedingungen Online-Bestellung</a>. Preise ohne MWST, sofern geschuldet.</p>
          </div>
        </div>
      </section>

      {today <= SWITCH_UNTIL ? (
        <section className={s.section}>
          <h2 className={s.h2}>Ihr Bestellsystem wird eingestellt?</h2>
          <p className={s.intro}>GloriaFood wird am 30. April 2027 abgeschaltet. Wir übernehmen Ihre Speisekarte per Import, aus Ihrer Website, einem PDF oder einer Tabelle, und richten {contact.name} mit Ihnen ein, damit Ihre Gäste ohne Unterbruch weiter bestellen können.</p>
          <a className={s.btnGhost} href={talk}>Wechsel besprechen</a>
        </section>
      ) : null}

      <Faq title="Häufige Fragen" items={faq} />

      <ContactBlock contact={contact} title="Schauen wir uns Ihr Restaurant gemeinsam an." text="Wir zeigen Ihnen Ihre Speisekarte als Online-Bestellung und rechnen aus, was Sie gegenüber heute sparen. Unverbindlich und kostenlos." subject="Pontivo für unser Restaurant" />
    </MarketingShell>
  );
}
