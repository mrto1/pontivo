import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import s from "./marketing.module.css";
import { env } from "@/src/env";
import { accountLink } from "@/src/services/account-link";

export const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--pv-display", display: "swap" });
export const body = Instrument_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--pv-body", display: "swap" });

/** Logo: das P als Brücke. Pontivo = lat. pons; der Bogen endet im Punkt des Gastes (Bernstein). */
export function Logo() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path d="M30 82V44A23 23 0 0 1 76 44V56" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="76" cy="71" r="8" fill="var(--pv-fee)" />
    </svg>
  );
}

/** Schweizer Flagge als Grafik: Flaggen-Emoji erscheinen unter Windows nur als Buchstaben «CH» */
export function SwissFlag() {
  return (
    <svg className={s.flag} viewBox="0 0 32 32" role="img" aria-label="Schweiz">
      <rect width="32" height="32" rx="4" fill="#d52b1e" />
      <path d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z" fill="#fff" />
    </svg>
  );
}

/** Rahmen der Plattform-Unterseiten (Registrieren, Eignung, Rechtliches): gleiche Kopfzeile, Farben und Schrift wie die Startseite */
export async function PlatformFrame({ children, hideSignup, narrow }: { children: React.ReactNode; hideSignup?: boolean; narrow?: boolean }) {
  const st = process.env.STATIC_SITE === "1";
  const a = st ? null : await accountLink();
  const name = env().PLATFORM_NAME;
  const home = st ? "index.html" : "/";
  return (
    <div className={`${s.page} pv-site ${display.variable} ${body.variable}`}>
      <div className={s.wrap} style={narrow ? { maxWidth: 820 } : undefined}>
        <header className={s.head}>
          <a className={s.logo} href={home}><Logo />{name}</a>
          {st ? null : (
            <nav className={s.headLinks} aria-label="Hauptnavigation">
              <a className={s.loginLink} href="/mypontivo/login">{a ? a.label : "Anmelden"}</a>
              {a || hideSignup ? null : <a className={s.btn} href="/registrieren">Registrieren</a>}
            </nav>
          )}
        </header>
        {children}
        <footer className={s.foot}>
          <span>© {new Date().getFullYear()} {name}</span>
          <span className={s.hosting}><SwissFlag /> Gehostet in der Schweiz</span>
          <nav className={s.footLinks} aria-label="Rechtliches">
            <a href={st ? "impressum.html" : "/impressum"}>Impressum</a>
            <a href={st ? "datenschutz.html" : "/datenschutz"}>Datenschutz</a>
            <a href={st ? "gastgeber-bedingungen.html" : "/gastgeber-bedingungen"}>Bedingungen für Gastgeber</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
