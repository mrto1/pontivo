import s from "./marketing.module.css";
import { display, body, Logo, SwissFlag } from "./Chrome";
import { ScrollEffects } from "./ScrollEffects";
import { pageHref } from "./PontivoHome";

export type ShellContact = { name: string; email?: string; phone?: string; staticSite?: boolean };

/** Mail-Link für «Gespräch vereinbaren» (ohne Adresse: Kontaktbereich der Seite) */
export const mailHref = (c: ShellContact, subject: string) => (c.email ? `mailto:${c.email}?subject=${encodeURIComponent(subject)}` : "#kontakt");

/**
 * Rahmen der öffentlichen Plattform-Seiten (SPEC 20.9): Startseite (Dachmarke), Unterkünfte, Restaurants.
 * Gleiche Kopfzeile, Farben und Schrift; «Restaurants» erscheint erst, wenn die Restaurant-Seite freigeschaltet ist.
 */
export function MarketingShell({ contact, account, current, heroImage, tagline, signupHref, children }: {
  contact: ShellContact; account: { label: string } | null; current: "home" | "unterkunft" | "restaurant";
  heroImage?: boolean; tagline: string; signupHref: string; children: React.ReactNode;
}) {
  const st = contact.staticSite;
  const link = (path: string, label: string, key: string) => <a href={pageHref(path, st)} aria-current={current === key ? "page" : undefined}>{label}</a>;
  return (
    <div className={`${s.page} ${display.variable} ${body.variable}`} data-pv-page>
      <ScrollEffects />
      {heroImage ? <div className={s.heroImg} aria-hidden="true" /> : null}
      <div className={s.wrap}>
        <header className={s.head}>
          <a className={s.logo} href={pageHref("/", st)}><Logo />{contact.name}</a>
          <nav className={s.headLinks} aria-label="Hauptnavigation">
            {link("/unterkunft", "Unterkünfte", "unterkunft")}
            {link("/restaurant", "Restaurants", "restaurant")}
            <a href="#kontakt">Kontakt</a>
            {st ? null : account ? null : <a className={s.loginLink} href="/admin/login">Anmelden</a>}
            {account && !st ? <a className={s.btn} href="/admin">{account.label}</a> : <a className={s.btn} href={st ? mailHref(contact, "Pontivo für unseren Betrieb") : signupHref}>{st ? "Anfragen" : "Registrieren"}</a>}
          </nav>
        </header>
        {children}
        <footer className={s.foot}>
          <span>© {new Date().getFullYear()} {contact.name}</span>
          <span className={s.hosting}><SwissFlag /> {tagline}</span>
          <nav className={s.footLinks} aria-label="Rechtliches">
            {st ? null : <a href="/admin/login">{account ? "Verwaltung" : "Anmelden"}</a>}
            <a href={pageHref("/impressum", st)}>Impressum</a>
            <a href={pageHref("/datenschutz", st)}>Datenschutz</a>
            <a href={pageHref("/gastgeber-bedingungen", st)}>Bedingungen für Gastgeber</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** Abschluss jeder Seite: Gespräch vereinbaren */
export function ContactBlock({ contact, title, text, subject }: { contact: ShellContact; title: string; text: string; subject: string }) {
  return (
    <section className={s.section} id="kontakt">
      <div className={s.contact}>
        <div>
          <h2 className={s.h2}>{title}</h2>
          <p>{text}</p>
        </div>
        <div className={s.contactLinks}>
          {contact.email ? <a className={s.btn} href={mailHref(contact, subject)}>Gespräch vereinbaren</a> : null}
          {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
          {contact.phone ? <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>{contact.phone}</a> : null}
          {!contact.email && !contact.phone ? <p>Kontaktangaben folgen.</p> : null}
        </div>
      </div>
    </section>
  );
}

export function Faq({ title, items }: { title: string; items: { q: string; a: string }[] }) {
  return (
    <section className={`${s.section} ${s.faq}`} id="fragen">
      <h2 className={s.h2}>{title}</h2>
      {items.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </section>
  );
}
