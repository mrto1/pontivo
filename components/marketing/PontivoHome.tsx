import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import s from "./marketing.module.css";
import { SavingsCalculator } from "./SavingsCalculator";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--pv-display", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--pv-body", display: "swap" });

/** Gebühr pro Direktbuchung in Prozent (Standard für neue Hotels, siehe hotels.platform_fee_bps) */
const FEE_PERCENT = 1;

// Beispielbuchung im Hero: 2 Nächte à CHF 180
const BOOKING = 360;
const PORTAL = 0.17;

function Logo() {
  // Ein Brückenbogen: Pontivo = lat. pons, Brücke zwischen Hotel und Gast
  return (
    <svg viewBox="0 0 34 20" aria-hidden="true">
      <path d="M2 18 Q17 -2 32 18" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M2 18 H32" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

const fmt = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");

export type Contact = { name: string; email?: string; phone?: string; demoUrl?: string };

export function PontivoHome({ contact, children }: { contact: Contact; children?: React.ReactNode }) {
  const portalFee = BOOKING * PORTAL;
  const ourFee = (BOOKING * FEE_PERCENT) / 100;
  const mail = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent("Pontivo für unser Hotel")}` : "#kontakt";

  return (
    <div className={`${s.page} ${display.variable} ${body.variable}`}>
      <div className={s.wrap}>
        <header className={s.head}>
          <a className={s.logo} href="/"><Logo />{contact.name}</a>
          <nav className={s.headLinks} aria-label="Hauptnavigation">
            <a href="#wege">Angebot</a>
            <a href="#ablauf">Ablauf</a>
            <a href="#rechner">Rechner</a>
            <a href="#preis">Preis</a>
            <a href="#fragen">Fragen</a>
            <a href={mail}>Kontakt</a>
            <a className={s.btn} href="/registrieren">Registrieren</a>
          </nav>
        </header>

        <section className={s.hero}>
          <div>
            <h1 className={s.heroTitle}>Ihre Gäste buchen direkt bei Ihnen. Die Provision bleibt im Haus.</h1>
            <p className={s.heroLead}>
              {contact.name} bringt Online-Buchung mit TWINT und Kartenzahlung auf Ihre bestehende Website – oder gibt Ihnen eine neue. Booking.com läuft weiter und wird automatisch abgeglichen. Sie zahlen {FEE_PERCENT} % pro Direktbuchung, mindestens CHF 19 im Monat – sonst nichts.
            </p>
            <div className={s.heroActions}>
              <a className={s.btn} href="/registrieren">Jetzt selbst einrichten</a>
              <a className={s.btnGhost} href={mail}>Gespräch vereinbaren</a>
              {contact.demoUrl ? <a className={s.btnGhost} href={contact.demoUrl}>Demo-Hotel ansehen</a> : null}
            </div>
          </div>

          <figure className={s.receipt} aria-label={`Beispiel: Buchung über CHF ${fmt(BOOKING)}`}>
            <div className={s.receiptHead}>
              <span className={s.receiptTitle}>Eine Buchung, 2 Nächte</span>
              <span className={s.receiptSum}>CHF {fmt(BOOKING)}</span>
            </div>
            <div className={s.row}>
              <div className={s.rowLabel}><span>Über ein Buchungsportal</span><span>Ihnen bleiben <strong>CHF {fmt(BOOKING - portalFee)}</strong></span></div>
              <div className={s.bar} role="img" aria-label={`Portal behält CHF ${fmt(portalFee)}`}>
                <div className={s.keep} style={{ width: `${100 - PORTAL * 100}%` }} />
                <div className={`${s.fee} ${s.grow}`} style={{ width: `${PORTAL * 100}%` }}>– {fmt(portalFee)}</div>
              </div>
            </div>
            <div className={s.row}>
              <div className={s.rowLabel}><span>Direkt über {contact.name}</span><span>Ihnen bleiben <strong>CHF {fmt(BOOKING - ourFee)}</strong></span></div>
              <div className={s.bar} role="img" aria-label={`${contact.name} behält CHF ${fmt(ourFee)}`}>
                <div className={s.keep} style={{ width: `${100 - FEE_PERCENT}%` }} />
                <div className={s.fee} style={{ width: `${FEE_PERCENT}%` }} />
              </div>
            </div>
            <div className={s.legend}>
              <span><i className={s.dot} style={{ background: "var(--pv-keep)" }} />bleibt beim Hotel</span>
              <span><i className={s.dot} style={{ background: "var(--pv-fee)" }} />Provision</span>
            </div>
            <p className={s.receiptNote}>Rechenbeispiel mit 17 % Portal-Provision. Zahlungsgebühren fallen in beiden Fällen an.</p>
          </figure>
        </section>

        <section className={s.section} id="wege">
          <h2 className={s.h2}>Passend zu Ihrer heutigen Website</h2>
          <p className={s.intro}>Sie entscheiden, wie viel {contact.name} übernimmt. Buchung, Zahlung und der Abgleich mit Booking.com sind bei allen drei Wegen gleich.</p>
          <div className={s.paths}>
            <article className={`${s.path} ${s.pathMain}`}>
              <h3>Ihre Website bleibt, die Buchung kommt von uns</h3>
              <p>Auf Ihrer Website erscheint ein Knopf «Jetzt buchen» oder eine Suchleiste mit Daten und Personen. Die Buchungsseite trägt Ihr Logo und Ihre Farben.</p>
              <ul>
                <li>Funktioniert mit Wix, WordPress, Jimdo und jeder anderen Website</li>
                <li>Einfachste Variante: den bestehenden «Buchen»-Link umstellen</li>
                <li>Kein Relaunch, keine neue Agentur</li>
              </ul>
            </article>
            <article className={s.path}>
              <h3>Neue Website mit Buchung</h3>
              <p>Für Hotels ohne Online-Buchung oder mit veralteter Seite: Startseite, Zimmer mit Fotos und Buchung auf Deutsch und Englisch, unter Ihrer Domain.</p>
            </article>
            <article className={s.path}>
              <h3>Wechsel von Ihrer heutigen Buchungsmaschine</h3>
              <p>Statt einer festen Monatsgebühr zahlen Sie nur bei einer Buchung. Dazu TWINT, Abgleich mit Booking.com und alles an einem Ort.</p>
            </article>
          </div>
        </section>

        <section className={s.section} id="ablauf">
          <h2 className={s.h2}>In drei Schritten zur eigenen Direktbuchung</h2>
          <p className={s.intro}>Sie müssen nichts installieren und keine neue Software lernen. Wir richten alles ein und bleiben Ihr Ansprechpartner.</p>
          <ol className={s.steps}>
            <li>
              <h3>Kennenlernen</h3>
              <p>Wir schauen Ihre heutige Website und Ihre Buchungswege an und zeigen Ihnen am Beispiel, wie Ihre Seite aussehen würde.</p>
            </li>
            <li>
              <h3>Wir richten ein</h3>
              <p>Zimmer, Preise, Fotos, Zahlungskonto und Abgleich mit Booking.com – und je nach Weg den Buchungs-Knopf auf Ihrer Website oder die neue Website.</p>
            </li>
            <li>
              <h3>Gäste buchen direkt</h3>
              <p>Wer Sie auf Google oder Ihrer Website findet, bucht direkt bei Ihnen und bezahlt sofort. Das Geld kommt direkt auf Ihr Konto.</p>
            </li>
          </ol>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>Was Sie davon haben</h2>
          <dl className={s.benefits}>
            <div className={s.benefit}><dt>{FEE_PERCENT} % statt 15–18 %</dt><dd>Für jede Buchung, die direkt statt übers Portal kommt, bleibt der Grossteil der Provision bei Ihnen.</dd></div>
            <div className={s.benefit}><dt>Geld direkt auf Ihr Konto</dt><dd>Die Zahlung läuft über Stripe auf Ihr eigenes Konto. Wir halten nie Geld Ihrer Gäste.</dd></div>
            <div className={s.benefit}><dt>TWINT, Karte, Apple Pay, Google Pay</dt><dd>Gäste bezahlen so, wie sie es gewohnt sind – auch auf dem Handy in wenigen Sekunden.</dd></div>
            <div className={s.benefit}><dt>Booking.com läuft weiter</dt><dd>Freie Zimmer und Preise werden automatisch abgeglichen. Buchungen aus dem Portal erscheinen ebenfalls bei Ihnen. Doppelbuchungen werden sofort gemeldet.</dd></div>
            <div className={s.benefit}><dt>Kurtaxe richtig berechnet</dt><dd>Die Kurtaxe Ihrer Gemeinde wird je nach Alter der Gäste automatisch ausgewiesen.</dd></div>
            <div className={s.benefit}><dt>Stornos ohne Telefonate</dt><dd>Gäste stornieren selbst über ihren Buchungslink. Die Rückerstattung nach Ihren Bedingungen läuft automatisch.</dd></div>
            <div className={s.benefit}><dt>Alles an einem Ort</dt><dd>Kalender, Preise, Buchungen und Monatsabrechnung – einfach genug, dass auch Mitarbeitende damit arbeiten.</dd></div>
            <div className={s.benefit}><dt>Günstiger direkt anbieten ist erlaubt</dt><dd>Seit Dezember 2022 dürfen Schweizer Hotels auf der eigenen Website tiefere Preise verlangen als auf Portalen.</dd></div>
          </dl>
        </section>

        <section className={s.section} id="rechner">
          <h2 className={s.h2}>Rechnen Sie selbst</h2>
          <p className={s.intro}>Schieben Sie die Regler auf Ihre Zahlen. Der Rechner zeigt, wie viel Provision zusätzlich bei Ihnen bleibt.</p>
          <SavingsCalculator feePercent={FEE_PERCENT} />
        </section>

        <section className={s.section} id="preis">
          <div className={s.price}>
            <div className={s.priceFig}>{FEE_PERCENT} %</div>
            <div>
              <h2 className={s.h2}>Sie zahlen nur, wenn Gäste direkt buchen</h2>
              <ul className={s.priceList}>
                <li>{FEE_PERCENT} % pro Direktbuchung, automatisch bei der Zahlung abgezogen</li>
                <li>Mindestens CHF 19 pro Monat: Liegen die {FEE_PERCENT} % darunter, wird nur die Differenz belastet</li>
                <li>Keine Einrichtungsgebühr, monatlich kündbar</li>
                <li>Bei Stornierung wird die Gebühr anteilig zurückerstattet</li>
                <li>Buchungen über Booking.com &amp; Co. kosten bei uns nichts</li>
                <li>Zahlungsgebühren von Stripe gehen wie bei jedem Kartenterminal zu Ihren Lasten</li>
              </ul>
            </div>
          </div>
        </section>

        <section className={`${s.section} ${s.faq}`} id="fragen">
          <h2 className={s.h2}>Häufige Fragen</h2>
          <details>
            <summary>Muss ich Booking.com kündigen?</summary>
            <p>Nein. Booking.com bleibt ein wichtiger Kanal für neue Gäste. {contact.name} sorgt dafür, dass Gäste, die Sie bereits kennen oder auf Google finden, direkt buchen können.</p>
          </details>
          <details>
            <summary>Darf ich auf meiner Website günstiger sein als auf Booking.com?</summary>
            <p>Ja. Seit dem 1. Dezember 2022 sind Klauseln verboten, die Schweizer Hotels daran hindern, auf der eigenen Website tiefere Preise anzubieten.</p>
          </details>
          <details>
            <summary>Was passiert mit meiner bestehenden Website?</summary>
            <p>Sie bleibt, wenn Sie möchten. Wir fügen nur einen Buchungs-Knopf oder eine Suchleiste ein, oder Sie stellen Ihren bestehenden «Buchen»-Link um. Wünschen Sie eine neue Website, übernehmen wir Ihre Inhalte und Fotos unter Ihrer bisherigen Domain.</p>
          </details>
          <details>
            <summary>Ich habe schon eine Buchungsmaschine. Lohnt sich ein Wechsel?</summary>
            <p>Das hängt davon ab, was Sie heute zahlen und wie viele Direktbuchungen Sie haben. Wir rechnen es im ersten Gespräch mit Ihren Zahlen durch – mit {contact.name} zahlen Sie nur, wenn tatsächlich gebucht wird.</p>
          </details>
          <details>
            <summary>Ich habe schon eine Hotelsoftware oder einen Channel-Manager. Geht das trotzdem?</summary>
            <p>In vielen Fällen ja. Wir prüfen im ersten Gespräch, wie Ihre Software angebunden werden kann.</p>
          </details>
          <details>
            <summary>Wo sind die Daten meiner Gäste?</summary>
            <p>Gastdaten bearbeiten wir in Ihrem Auftrag nach Schweizer Datenschutzgesetz. Kartendaten sehen weder wir noch Sie – die verarbeitet ausschliesslich der Zahlungsdienst Stripe.</p>
          </details>
          <details>
            <summary>Wer ist Vertragspartner des Gastes?</summary>
            <p>Immer Ihr Hotel. {contact.name} stellt nur die Technik zur Verfügung und ist weder Reiseveranstalter noch Vermittler mit eigener Provision auf Ihren Zimmerpreis.</p>
          </details>
        </section>

        <section className={s.section} id="kontakt">
          <div className={s.contact}>
            <div>
              <h2 className={s.h2}>Schauen wir uns Ihr Hotel gemeinsam an</h2>
              <p>Im ersten Gespräch zeigen wir Ihnen, wie Ihre Website mit Direktbuchung aussehen würde und was Sie damit sparen. Unverbindlich und kostenlos.</p>
            </div>
            <div className={s.contactLinks}>
              {contact.email ? <a className={s.btn} href={mail}>E-Mail schreiben</a> : null}
              {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
              {contact.phone ? <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>{contact.phone}</a> : null}
              {!contact.email && !contact.phone ? <p>Kontaktangaben folgen.</p> : null}
            </div>
          </div>
        </section>

        <footer className={s.foot}>
          <span>© {new Date().getFullYear()} {contact.name}</span>
          <span>Direktbuchung für Hotels in der Schweiz</span>
        </footer>
        {children ? <div className={s.dev}>{children}</div> : null}
      </div>
    </div>
  );
}
