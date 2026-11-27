import s from "./marketing.module.css";
import type { ResolvedSite } from "@/src/domain/pontivo-site";

/**
 * Bausteine-Übersicht der Pontivo-Seite: Baukasten-Grafik, Funktionsgruppen, Ablauf vom Klick bis zur Buchhaltung.
 * Alle Grafiken sind eigene, inline gezeichnete SVG (keine Fremdbilder), Farben aus den Seiten-Tokens (hell/dunkel).
 * Inhalte entsprechen src/domain/modules.ts und den gebauten Funktionen (SPEC 16–18).
 */

const ICONS: Record<string, string> = {
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  card: "M3 6h18v12H3z M3 10h18 M6 15h4",
  globe: "M12 3a9 9 0 100 18 9 9 0 000-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18",
  chat: "M4 5h16v11H9l-5 4z",
  bed: "M3 18V7 M3 14h18v4 M21 14v-2a3 3 0 00-3-3h-7v5 M6 11h.01",
  sparkle: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z",
  notebook: "M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4",
  chart: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  users: "M9 11a3 3 0 100-6 3 3 0 000 6z M3 20a6 6 0 0112 0 M17 8a3 3 0 010 6 M21 20a5 5 0 00-4-4.9",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  coin: "M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v10 M9.5 9.5c0-1 1.5-1.5 2.5-1.5s2.5.7 2.5 1.7S13 11.5 12 12s-2.5 1-2.5 2.3S11 16 12 16s2.5-.5 2.5-1.5",
  table: "M4 5h16v14H4z M4 10h16 M4 15h16 M10 5v14",
  mail: "M3 6h18v12H3z M3 7l9 7 9-7",
  plug: "M7 3v5 M13 3v5 M5 8h10v3a5 5 0 01-10 0z M10 16v5",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  reader: "M7 3h10v18H7z M9 6h6v4H9z M9 14h2 M13 14h2 M9 17h2 M13 17h2",
  lock: "M6 11h12v9H6z M8 11V8a4 4 0 018 0v3 M12 15v2",
  gift: "M4 9h16v4H4z M5 13h14v7H5z M12 9v11 M12 9c-3 0-4-4-1.5-4S12 9 12 9z M12 9c3 0 4-4 1.5-4S12 9 12 9z",
  bag: "M6 8h12l-1 12H7z M9 8a3 3 0 016 0 M12 11v5 M9.5 13.5h5",
  house: "M4 21V8l8-5 8 5v13 M9 21v-6h6v6",
  question: "M12 3a9 9 0 100 18 9 9 0 000-18z M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4 M12 17h.01",
  phone: "M8 3h8v18H8z M11 18h2",
  palette: "M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3A9 9 0 0012 3z M8 10h.01 M12 7h.01 M16 10h.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  idcard: "M3 5h18v14H3z M7 10a2 2 0 104 0 2 2 0 00-4 0 M14 9h4 M14 13h4",
  cancel: "M4 12a8 8 0 1114 5.3 M18 20v-3h-3",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

type Tag = "Immer dabei" | "Standard" | "Optional" | "Zusatzpreis" | "Neu";
type Mod = { icon: keyof typeof ICONS; title: string; text: string; tag: Tag };
type Group = { id: string; title: string; lead: string; mods: Mod[] };

const GROUPS: Group[] = [
  {
    id: "buchen", title: "Buchen und bezahlen", lead: "Der Kern. Er ist bei jedem Betrieb dabei.",
    mods: [
      { icon: "calendar", title: "Direktbuchung", text: "Suche nach Daten und Personen, Zimmertypen und Tarife, Preise pro Nacht, Mehrsprachig.", tag: "Immer dabei" },
      { icon: "card", title: "Zahlung auf Ihr Konto", text: "TWINT, Karte, Apple Pay und Google Pay über Stripe. Das Geld geht direkt an Sie.", tag: "Immer dabei" },
      { icon: "cancel", title: "Storno und Restzahlung", text: "Stornoregeln, Rückerstattung, Anzahlung mit Restzahlung per Link. Alles ohne Telefonate.", tag: "Immer dabei" },
      { icon: "gift", title: "Gutscheine", text: "Gutscheine online verkaufen und im Haus einlösen.", tag: "Standard" },
      { icon: "bag", title: "Upselling (KI-Modul)", text: "Das KI-Modul schlägt Gästen vor der Anreise passende Extras vor, etwa Frühstück, Spa oder Parkplatz. Der Versand läuft automatisch, Sie geben die Angebote frei.", tag: "Zusatzpreis" },
      { icon: "chart", title: "Preisempfehlung (KI-Modul)", text: "Die KI schlägt Preise nach Auslastung und Nachfrage vor. Sie entscheiden, nichts wird ohne Ihre Freigabe geändert. Im KI-Zusatz für CHF 29 im Monat.", tag: "Zusatzpreis" },
    ],
  },
  {
    id: "web", title: "Website und Auftritt", lead: "Neue Website oder Buchung auf Ihrer bestehenden.",
    mods: [
      { icon: "palette", title: "Hotel-Website", text: "9 Layouts und 8 Schriftpaare, Logo und Farbe, Texte in fünf Sprachen mit KI-Übersetzung.", tag: "Standard" },
      { icon: "globe", title: "In Ihre Website einbauen", text: "Knopf oder Suchleiste für Wix, WordPress, Jimdo und jede andere Seite.", tag: "Standard" },
      { icon: "chat", title: "KI-Chat für Gäste", text: "Beantwortet Fragen zum Haus und zur Umgebung, auch während des Aufenthalts.", tag: "Zusatzpreis" },
      { icon: "mail", title: "Eigene Mail-Texte", text: "Ihre Worte in Bestätigung, Vor der Anreise und Nachher. Rechtliche Teile bleiben fest.", tag: "Standard" },
    ],
  },
  {
    id: "betrieb", title: "Rezeption und Betrieb", lead: "Für Häuser mit Personal. Ferienwohnungen lassen es einfach aus.",
    mods: [
      { icon: "bed", title: "Rezeption", text: "Tagesliste mit Anreisen, Abreisen und Gästen im Haus. Zimmerplan mit Zimmernummern.", tag: "Standard" },
      { icon: "sparkle", title: "Housekeeping", text: "Reinigungsstatus je Zimmer, Handy-Liste für das Reinigungsteam, Mängel melden.", tag: "Optional" },
      { icon: "notebook", title: "Gästekartei", text: "Notizen und Tags zu Gästen, mit Suche. Stammgäste erkennen, Wünsche merken.", tag: "Optional" },
      { icon: "idcard", title: "Online-Check-in", text: "Gäste füllen vor der Anreise das Meldeformular aus. Sensible Daten sind verschlüsselt.", tag: "Standard" },
      { icon: "house", title: "Gruppen", text: "Zimmerblock mit Freigabefrist, Rooming-Liste und eine Rechnung an die Firma.", tag: "Optional" },
      { icon: "users", title: "Team und Rollen", text: "Inhaber, Manager und Mitarbeitende, dazu Rezeption, Housekeeping und Buchhaltung mit eigenem Zugang.", tag: "Standard" },
      { icon: "notebook", title: "Restaurant im Haus", text: "Tischplan und Reservation, Halbpension mit automatisch reserviertem Tisch, Konsumation mit einem Klick aufs Zimmer.", tag: "Optional" },
      { icon: "question", title: "Anfragen", text: "Anfragen von der Website und aus dem Chat an einem Ort.", tag: "Standard" },
      { icon: "phone", title: "Admin als App", text: "Auf dem Handy installierbar, mit Mitteilung bei neuer Buchung.", tag: "Standard" },
    ],
  },
  {
    id: "zahlen", title: "Rechnung, Kurtaxe und Zahlen", lead: "Schweizer Details sind eingebaut.",
    mods: [
      { icon: "invoice", title: "Rechnung und Kasse", text: "Rechnungen mit 3.8 % und 8.1 % MWST, QR-Rechnung, Gutschrift, Zahlungen vor Ort, Rechnung per Mail.", tag: "Standard" },
      { icon: "coin", title: "Kurtaxe", text: "Gemeindesatz nach Alter der Gäste, Quartalsabrechnung für die Gemeinde als Liste.", tag: "Standard" },
      { icon: "table", title: "Buchhaltungs-Export", text: "Rechnungen und Zahlungen als Buchungsliste für Ihren Treuhänder.", tag: "Optional" },
      { icon: "chart", title: "Statistik", text: "Belegung, Durchschnittspreis, Umsatz pro Zimmer und Herkunft der Buchungen.", tag: "Standard" },
    ],
  },
  {
    id: "vernetzen", title: "Vertrieb und Hardware", lead: "Verbindet Pontivo mit Portalen und mit Geräten im Haus.",
    mods: [
      { icon: "plug", title: "Booking.com-Abgleich", text: "Zimmer und Preise werden automatisch abgeglichen. Doppelbuchungen werden gemeldet.", tag: "Standard" },
      { icon: "link", title: "Kalender-Abgleich", text: "iCal-Kalender von Airbnb und anderen Portalen einlesen und ausgeben.", tag: "Standard" },
      { icon: "globe", title: "Google", text: "Knöpfe «Buchen», «Reservieren» und «Bestellen» im Google-Unternehmensprofil, kostenlose Buchungslinks in der Hotelsuche. Buchungen über Google zeigt die Statistik.", tag: "Neu" },
      { icon: "reader", title: "Kartenterminal", text: "Karte am Empfang mit einem Stripe-Leser. Die Zahlung landet automatisch in der Buchung.", tag: "Neu" },
      { icon: "lock", title: "Türcodes mit Nuki", text: "Pro Buchung ein Code für Eingang und Zimmer, nur für die Dauer des Aufenthalts.", tag: "Neu" },
    ],
  },
];

/** Baukasten: ein Kern, Bausteine docken an, jeder Baustein hat einen Schalter */
function BuildGraphic() {
  const W = 176;
  const tiles = [
    { x: 16, y: 22, t: "Rezeption", on: true }, { x: 204, y: 22, t: "Housekeeping", on: true },
    { x: 16, y: 118, t: "Rechnung", on: true }, { x: 204, y: 118, t: "Gruppen", on: false },
    { x: 520, y: 22, t: "Kurtaxe", on: true }, { x: 708, y: 22, t: "Nuki", on: false },
    { x: 520, y: 118, t: "Statistik", on: true }, { x: 708, y: 118, t: "Terminal", on: false },
  ];
  return (
    <svg className={s.buildSvg} viewBox="0 0 900 208" role="img" aria-label="Baukasten: Der Kern Direktbuchung in der Mitte, rundherum Bausteine, die einzeln ein- und ausgeschaltet werden">
      {/* Verbindungen zuerst, damit sie hinter den Kacheln liegen */}
      {tiles.map((t) => {
        const left = t.x < 450;
        return <path key={"l" + t.t} d={`M${left ? 100 : 800} ${t.y + 32} H${left ? 400 : 500}`} className={s.gLink} />;
      })}
      <rect x="400" y="52" width="100" height="104" rx="18" className={s.gCore} />
      <text x="450" y="98" textAnchor="middle" className={s.gCoreText}>Direkt-</text>
      <text x="450" y="120" textAnchor="middle" className={s.gCoreText}>buchung</text>
      {tiles.map((t) => (
        <g key={t.t}>
          <rect x={t.x} y={t.y} width={W} height="64" rx="14" className={t.on ? s.gTileOn : s.gTileOff} />
          <text x={t.x + 14} y={t.y + 38} className={t.on ? s.gTileText : s.gTileTextOff}>{t.t}</text>
          <rect x={t.x + W - 44} y={t.y + 23} width="30" height="18" rx="9" className={t.on ? s.gSwitchOn : s.gSwitchOff} />
          <circle cx={t.on ? t.x + W - 23 : t.x + W - 35} cy={t.y + 32} r="6.5" className={s.gKnob} />
        </g>
      ))}
    </svg>
  );
}

/** Steinbogenbrücke über einen Fluss (pons) mit Spiegelung: Zierband in gedämpften Seitenfarben (hell/dunkel) */
export function BridgeBand() {
  // Brückenkörper: Rechteck mit drei Bogenöffnungen (even-odd), Wasserlinie bei y=120
  const body = "M130 98Q540 22 950 98V120H130Z M168 120A98 44 0 0 1 364 120Z M442 120A98 44 0 0 1 638 120Z M716 120A98 44 0 0 1 912 120Z";
  return (
    <svg className={s.band} viewBox="0 0 1080 190" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="pvFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--pv-paper)", stopOpacity: 0 }} />
          <stop offset="0.85" style={{ stopColor: "var(--pv-paper)", stopOpacity: 1 }} />
        </linearGradient>
        <linearGradient id="pvWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--pv-keep)", stopOpacity: 0.16 }} />
          <stop offset="1" style={{ stopColor: "var(--pv-keep)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <circle cx="790" cy="40" r="18" className={s.sun} />
      <rect x="0" y="120" width="1080" height="70" fill="url(#pvWater)" />
      <g transform="translate(0 240) scale(1 -1)" opacity="0.28">
        <path d={body} fillRule="evenodd" className={s.stone} />
      </g>
      <rect x="0" y="120" width="1080" height="70" fill="url(#pvFade)" />
      <path d={body} fillRule="evenodd" className={s.stone} />
      <path d="M130 98Q540 22 950 98" className={s.rail} />
      <path d="M120 126q22-4 44 0t44 0M300 134q26-4 52 0t52 0M560 130q26-4 52 0t52 0M830 136q22-4 44 0t44 0" className={s.wave} />
    </svg>
  );
}

/** Beispiel: So sieht eine Hotel-Website aus, die mit Pontivo läuft (gezeichnet, keine echten Fotos) */
function SiteMock() {
  return (
    <figure className={s.mock}>
      <div className={s.mockFrame} role="img" aria-label="Beispiel einer Hotel-Website mit Pontivo: Titelbild, Suche nach Daten und Gästen, Zimmer mit Preis">
        <div className={s.mockBar}><i /><i /><i /><span>www.ihr-haus.ch</span></div>
        <div className={s.mockHero}>
          <div className={s.mockNav}><b>Haus Beispiel</b><span>Zimmer</span><span>Das Haus</span><span>Lage</span><span>Kontakt</span></div>
          <div className={s.mockSun} />
          <div className={s.mockTitle}>Ankommen und durchatmen</div>
          <div className={s.mockSearch}>
            <div><small>Anreise</small>12. Dez.</div>
            <div><small>Abreise</small>14. Dez.</div>
            <div><small>Gäste</small>2 Erwachsene</div>
            <button type="button" tabIndex={-1}>Verfügbarkeit prüfen</button>
          </div>
        </div>
        <div className={s.mockRooms}>
          <div><span className={s.mockPhoto} /><div><b>Doppelzimmer Süd</b><small>Balkon, Frühstück inklusive</small><em>ab CHF 180 pro Nacht</em></div></div>
          <div><span className={`${s.mockPhoto} ${s.mockPhoto2}`} /><div><b>Familienzimmer</b><small>Platz für vier, zwei Räume</small><em>ab CHF 260 pro Nacht</em></div></div>
        </div>
      </div>
      <figcaption>So kann Ihre Website mit Pontivo aussehen. Layout, Farben, Schrift und Texte stellen Sie selbst ein.</figcaption>
    </figure>
  );
}

const FLOW: { icon: keyof typeof ICONS; t: string; d: string }[] = [
  { icon: "calendar", t: "Gast bucht", d: "auf Ihrer Website, mit TWINT oder Karte" },
  { icon: "bed", t: "Rezeption", d: "Zimmer zuweisen, einchecken, Posten buchen" },
  { icon: "sparkle", t: "Reinigung", d: "Zimmer nach Abreise auf der Handy-Liste" },
  { icon: "invoice", t: "Rechnung", d: "MWST, QR-Rechnung, Kurtaxe, per Mail" },
  { icon: "table", t: "Buchhaltung", d: "Buchungsliste für Ihren Treuhänder" },
];

export function Bausteine({ staticSite, site }: { staticSite?: boolean; site: ResolvedSite }) {
  return (
    <>
      <section className={s.section} id="bausteine">
        <h2 className={s.h2}>{site.text("bausteine.title")}</h2>
        <p className={s.intro}>{site.text("bausteine.intro")}</p>
        <div className={s.buildWrap}><BuildGraphic /></div>
        <p className={s.buildNote}>Beispiel: Ein kleines Hotel schaltet Rezeption, Rechnung, Kurtaxe und Statistik ein. Das Chalet nebenan nur Rechnung und Kurtaxe.</p>
      </section>

      <section className={s.section} id="website">
        <h2 className={s.h2}>{site.text("web.title")}</h2>
        <p className={s.intro}>{site.text("web.intro")}</p>
        <div className={s.paths}>
          {(["1", "2", "3"] as const).map((n) => (
            <article key={n} className={s.path}>
              <span className={s.pathNo}>{n}</span>
              <h3>{site.text(`web.${n}.title`)}</h3>
              <p>{site.text(`web.${n}.text`)}</p>
              <ul>{site.lines(`web.${n}.bullets`).map((b) => <li key={b}>{b}</li>)}</ul>
            </article>
          ))}
        </div>
        <SiteMock />
      </section>

      <section className={s.section} id="funktionen">
        <h2 className={s.h2}>{site.text("funktionen.title")}</h2>
        <p className={s.intro}>{site.text("funktionen.intro")}</p>
        {GROUPS.map((g) => (
          <div key={g.id} className={s.group}>
            <h3 className={s.groupTitle}>{g.title}</h3>
            <p className={s.groupLead}>{g.lead}</p>
            <ul className={s.modGrid}>
              {g.mods.map((m) => (
                <li key={m.title} className={s.mod}>
                  <span className={s.modIcon}><Icon name={m.icon} /></span>
                  <div>
                    <div className={s.modHead}><strong>{m.title}</strong><span className={`${s.tag} ${s["tag" + m.tag.replace(/\s/g, "")]}`}>{m.tag}</span></div>
                    <p>{m.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className={s.fieldHint}>
          «Zusatzpreis» heisst: eigenes Modul mit eigenem Preis, das Sie nur bei Bedarf einschalten. «Neu» heisst: frisch eingebaut; Hardware (Kartenleser, Nuki) kaufen Sie bei Stripe und Nuki.{staticSite ? "" : " Alle Bausteine zeigen wir Ihnen gern im Demo-Hotel."}
        </p>
      </section>

      <section className={s.section} id="ablauf-gast">
        <h2 className={s.h2}>{site.text("ablaufgast.title")}</h2>
        <p className={s.intro}>{site.text("ablaufgast.intro")}</p>
        <ol className={s.flow}>
          {FLOW.map((f, i) => (
            <li key={f.t}>
              <span className={s.flowIcon}><Icon name={f.icon} /></span>
              <span className={s.flowNo}>{i + 1}</span>
              <strong>{f.t}</strong>
              <span>{f.d}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
