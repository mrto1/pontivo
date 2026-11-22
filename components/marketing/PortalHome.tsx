import s from "./marketing.module.css";
import { ContactBlock, Faq, MarketingShell, mailHref, type ShellContact } from "./Shell";
import { pageHref } from "./PontivoHome";

/**
 * Startseite der Dachmarke (SPEC 20.9, Texte: Claude Docs «Pontivo Website-Texte», Abschnitt 1).
 * Weiche zu Unterkünften und Restaurants; Restaurant-Knopf und -Kachel erst nach Freischaltung.
 */
export function PortalHome({ contact, account, restaurant, fee, minimum }: { contact: ShellContact; account: { label: string } | null; restaurant: boolean; fee: string; minimum: string }) {
  const st = contact.staticSite;
  const talk = mailHref(contact, "Pontivo für unseren Betrieb");
  const paths = [
    { title: "Unterkunft", text: "Hotel, B&B, Ferienwohnung, Chalet oder Berggasthaus. Gäste buchen auf Ihrer Website und zahlen sofort. Mit Kalender, Rechnung und Rezeption, wenn Sie wollen.", href: pageHref("/unterkunft", st), cta: "Mehr für Unterkünfte" },
    ...(restaurant ? [{ title: "Restaurant", text: "Restaurant, Café oder Take-away. Website, Tischreservation, Online-Bestellung und Kasse in einem System.", href: pageHref("/restaurant", st), cta: "Mehr für Restaurants" }] : []),
    { title: "Beides", text: "Hotel mit Restaurant? Dann läuft alles zusammen: Die Konsumation kommt mit einem Klick auf die Zimmerrechnung.", href: talk, cta: "Gespräch vereinbaren" },
  ];
  const benefits = [
    ["Ihre Gastbeziehung bleibt bei Ihnen.", "Name, E-Mail und Vorlieben Ihrer Gäste gehören Ihnen, nicht einem Portal."],
    ["Bezahlen wie in der Schweiz üblich.", "TWINT und Karte über Stripe. Das Geld geht direkt auf Ihr Konto."],
    ["Eine Website, die verkauft.", `Wir bauen sie Ihnen, oder ${contact.name} kommt auf Ihre bestehende Seite. Texte in mehreren Sprachen auf Knopfdruck.`],
    ["Nur einschalten, was Sie brauchen.", restaurant ? "Jede Funktion ist ein Schalter. Ein Chalet braucht keine Kasse, eine Pizzeria keinen Zimmerplan." : "Jede Funktion ist ein Schalter. Ein Chalet braucht keine Rezeption, ein Hotel mit Team schon."],
    ["Pontivo auf dem Handy.", restaurant ? "Neue Buchungen und Bestellungen kommen als Push-Mitteilung." : "Neue Buchungen kommen als Push-Mitteilung."],
    ["Aus der Schweiz.", "Server und Daten bei Infomaniak in Genf, Rechnungen mit QR-Code, MWST nach Schweizer Sätzen."],
  ];
  const faq = [
    { q: "Brauche ich alles?", a: `Nein. Der Kern ist die Buchung${restaurant ? " bzw. Bestellung" : ""} mit Zahlung. Alles andere schalten Sie einzeln ein oder aus.` },
    { q: "Wem gehören die Daten?", a: `Immer Ihrem Betrieb. ${contact.name} stellt nur die Technik zur Verfügung.` },
    { q: "Kann ich meine Website behalten?", a: `Ja. ${contact.name} lässt sich in bestehende Websites einbinden.` },
  ];
  return (
    <MarketingShell contact={contact} account={account} restaurant={restaurant} current="home" heroImage tagline={restaurant ? "Direktbuchung, Reservation und Bestellung für das Schweizer Gastgewerbe · Server und Datenbank bei Infomaniak in Genf" : "Direktbuchung für das Schweizer Gastgewerbe · Server und Datenbank bei Infomaniak in Genf"} signupHref="/registrieren">
      <section className={s.heroSolo}>
        <h1 className={s.heroTitle}>Ihre Gäste direkt bei Ihnen. Ohne Umweg.</h1>
        <p className={s.heroLead}>{restaurant ? `Gäste buchen, bestellen und reservieren direkt bei Ihnen, mit TWINT, Karte oder bar. Nur ${fee} % pro Buchung und Bestellung. Für Schweizer Unterkünfte und Restaurants.` : `Gäste buchen direkt bei Ihnen, mit TWINT oder Karte. Nur ${fee} % auf das, was über ${contact.name} läuft. Für Schweizer Unterkünfte.`}</p>
        <div className={s.heroActions}>
          <a className={s.btn} href={pageHref("/unterkunft", st)}>Für Unterkünfte</a>
          {restaurant ? <a className={s.btn} href={pageHref("/restaurant", st)}>Für Restaurants</a> : <a className={s.btnGhost} href={talk}>Gespräch vereinbaren</a>}
        </div>
      </section>

      <section className={s.section} id="weiche">
        <h2 className={s.h2}>Was führen Sie?</h2>
        <div className={`${s.paths}${paths.length === 2 ? ` ${s.pathsTwo}` : ""}`}>
          {paths.map((p) => (
            <a key={p.title} className={`${s.path} ${s.pathLink}`} href={p.href}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
              <span className={s.pathCta}>{p.cta} →</span>
            </a>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>Was alle Gastgeber bekommen</h2>
        <dl className={s.benefits}>
          {benefits.map(([t, d]) => <div key={t} className={s.benefit}><dt>{t}</dt><dd>{d}</dd></div>)}
        </dl>
      </section>

      <section className={s.section} id="preis">
        <div className={s.price}>
          <div className={s.priceFig}>{fee} %</div>
          <div>
            <h2 className={s.h2}>Sie zahlen nur, was über {contact.name} läuft</h2>
            <p>Einen kleinen Anteil an dem, was über {contact.name} läuft, und eine tiefe Mindestgebühr von {minimum} pro Monat. Keine Einrichtungsgebühr, keine Gebühr pro Gast, monatlich kündbar.</p>
            <p className={s.fieldHint}>Die genauen Preise stehen auf den Seiten für <a href={pageHref("/unterkunft", st) + "#preis"}>Unterkünfte</a>{restaurant ? <> und <a href={pageHref("/restaurant", st) + "#preise"}>Restaurants</a></> : null}. Preise ohne MWST, sofern geschuldet.</p>
          </div>
        </div>
      </section>

      <Faq title="Häufige Fragen" items={faq} />

      <ContactBlock contact={contact} title="Schauen wir uns Ihren Betrieb gemeinsam an." text={`Im ersten Gespräch zeigen wir Ihnen, wie Ihre Website mit ${contact.name} aussehen würde und was Sie damit sparen. Unverbindlich und kostenlos.`} subject="Pontivo für unseren Betrieb" />
    </MarketingShell>
  );
}
