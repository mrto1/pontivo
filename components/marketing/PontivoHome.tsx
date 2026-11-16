import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import s from "./marketing.module.css";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/src/domain/fee";
import { SavingsCalculator } from "./SavingsCalculator";
import { AlpineBand, Bausteine } from "./Modules";
import { resolveSite, type ResolvedSite } from "@/src/domain/pontivo-site";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--pv-display", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--pv-body", display: "swap" });

/** Gebühr pro Direktbuchung in Prozent (Standard für neue Hotels, siehe hotels.platform_fee_bps) */
const FEE_PERCENT = DEFAULT_PLATFORM_FEE_BPS / 100;

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

export type Contact = {
  name: string; email?: string; phone?: string; demoUrl?: string;
  /** Inhaber/Firma und Adresse (Impressum, Kontakt) */
  operator?: string; address?: string;
  /** Statische Fassung für einfachen Webspace: kein Login/Registrieren, Links auf .html-Dateien */
  staticSite?: boolean;
};

/** Link auf eine Plattform-Seite (statisch: Datei mit .html) */
export const pageHref = (path: string, staticSite?: boolean) => (staticSite ? (path === "/" ? "index.html" : `${path.slice(1)}.html`) : path);

export function PontivoHome({ contact, site: siteIn, account, children }: { contact: Contact; site?: ResolvedSite; /** angemeldet: Beschriftung des Links zu myPontivo */ account?: { label: string } | null; children?: React.ReactNode }) {
  const site = siteIn ?? resolveSite(null, { name: contact.name, fee: FEE_PERCENT, email: contact.email });
  const portalFee = BOOKING * PORTAL;
  const ourFee = (BOOKING * FEE_PERCENT) / 100;
  const mail = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent("Pontivo für unseren Betrieb")}` : "#kontakt";
  const st = contact.staticSite;
  const signup = st ? mail : "/registrieren";

  return (
    <div className={`${s.page} ${display.variable} ${body.variable}`}>
      <div className={s.wrap}>
        <header className={s.head}>
          <a className={s.logo} href="/"><Logo />{contact.name}</a>
          <nav className={s.headLinks} aria-label="Hauptnavigation">
            <a href="#wege">Angebot</a>
            <a href="#bausteine">Bausteine</a>
            <a href="#funktionen">Funktionen</a>
            <a href="#ablauf">Ablauf</a>
            <a href="#rechner">Rechner</a>
            <a href="#preis">Preis</a>
            <a href="#fragen">Fragen</a>
            <a href={mail}>Kontakt</a>
            {st ? null : account ? null : <a href="/admin/login">Anmelden</a>}
            {account && !st ? <a className={s.btn} href="/admin">{account.label}</a> : <a className={s.btn} href={signup}>{st ? "Anfragen" : "Registrieren"}</a>}
          </nav>
        </header>

        <section className={s.hero}>
          <div>
            <h1 className={s.heroTitle}>{site.text("hero.title")}</h1>
            <p className={s.heroLead}>{site.text("hero.lead")}</p>
            <div className={s.heroActions}>
              {st ? <a className={s.btn} href={mail}>{site.text("hero.ctaSecond")}</a> : (<>
                <a className={s.btn} href="/registrieren">{site.text("hero.ctaMain")}</a>
                <a className={s.btnGhost} href={mail}>{site.text("hero.ctaSecond")}</a>
              </>)}
              {contact.demoUrl && !st ? <a className={s.btnGhost} href={contact.demoUrl}>Demo-Hotel ansehen</a> : null}
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

        <AlpineBand />

        <section className={s.section} id="wege">
          <h2 className={s.h2}>{site.text("wege.title")}</h2>
          <p className={s.intro}>{site.text("wege.intro")}</p>
          <div className={s.paths}>
            <article className={`${s.path} ${s.pathMain}`}>
              <h3>{site.text("wege.1.title")}</h3>
              <p>{site.text("wege.1.text")}</p>
              <ul>{site.lines("wege.1.bullets").map((b) => <li key={b}>{b}</li>)}</ul>
            </article>
            <article className={s.path}>
              <h3>{site.text("wege.2.title")}</h3>
              <p>{site.text("wege.2.text")}</p>
            </article>
            <article className={s.path}>
              <h3>{site.text("wege.3.title")}</h3>
              <p>{site.text("wege.3.text")}</p>
            </article>
          </div>
        </section>

        <Bausteine staticSite={st} site={site} />

        <section className={s.section} id="ablauf">
          <h2 className={s.h2}>{site.text("ablauf.title")}</h2>
          <p className={s.intro}>{site.text("ablauf.intro")}</p>
          <ol className={s.steps}>
            {[1, 2, 3].map((i) => (
              <li key={i}>
                <h3>{site.text(`step.${i}.title`)}</h3>
                <p>{site.text(`step.${i}.text`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>{site.text("vorteile.title")}</h2>
          <dl className={s.benefits}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className={s.benefit}><dt>{site.text(`benefit.${i}.title`)}</dt><dd>{site.text(`benefit.${i}.text`)}</dd></div>
            ))}
          </dl>
        </section>

        <section className={s.section} id="rechner">
          <h2 className={s.h2}>{site.text("rechner.title")}</h2>
          <p className={s.intro}>{site.text("rechner.intro")}</p>
          <SavingsCalculator feePercent={FEE_PERCENT} />
        </section>

        <section className={s.section} id="preis">
          <div className={s.price}>
            <div className={s.priceFig}>{FEE_PERCENT} %</div>
            <div>
              <h2 className={s.h2}>{site.text("preis.title")}</h2>
              <ul className={s.priceList}>
                {[1, 2, 3, 4, 5, 6].map((i) => <li key={i}>{site.text(`preis.${i}`)}</li>)}
              </ul>
              <p className={s.fieldHint}>Alle Einzelheiten: <a href={pageHref("/gastgeber-bedingungen", st)}>Bedingungen für Gastgeber</a>. Preise ohne MWST, sofern geschuldet.</p>
            </div>
          </div>
        </section>

        <section className={`${s.section} ${s.faq}`} id="fragen">
          <h2 className={s.h2}>{site.text("fragen.title")}</h2>
          {site.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>

        <section className={s.section} id="kontakt">
          <div className={s.contact}>
            <div>
              <h2 className={s.h2}>{site.text("kontakt.title")}</h2>
              <p>{site.text("kontakt.text")}</p>
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
          <span>{site.text("foot.tagline")}</span>
          <nav className={s.footLinks} aria-label="Rechtliches">
            {st ? null : <a href="/admin/login">{account ? "myPontivo" : "Anmelden"}</a>}
            <a href={pageHref("/impressum", st)}>Impressum</a>
            <a href={pageHref("/datenschutz", st)}>Datenschutz</a>
            <a href={pageHref("/gastgeber-bedingungen", st)}>Bedingungen für Gastgeber</a>
          </nav>
        </footer>
        {children ? <div className={s.dev}>{children}</div> : null}
      </div>
    </div>
  );
}
