import s from "./marketing.module.css";

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
      { icon: "bag", title: "Upselling", text: "Frühstück, Spa oder Parkplatz vor der Anreise anbieten, mit Mail an den Gast.", tag: "Zusatzpreis" },
    ],
  },
  {
    id: "web", title: "Website und Auftritt", lead: "Neue Website oder Buchung auf Ihrer bestehenden.",
    mods: [
      { icon: "palette", title: "Hotel-Website", text: "8 Layouts und 8 Schriftpaare, Logo und Farbe, Texte auf Deutsch und Englisch mit KI-Übersetzung.", tag: "Standard" },
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

/** Alpen und Brücke: Zierband, gleiche Bildsprache wie das Logo */
export function AlpineBand() {
  return (
    <svg className={s.band} viewBox="0 0 1080 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d="M0 150V92l90-52 70 46 110-70 120 82 80-44 130 84 100-60 120 74 90-58 160 70v66z" className={s.mtFar} />
      <path d="M0 150v-40l120-30 90 34 110-46 150 52 90-30 140 40 110-36 130 34 140-24v46z" className={s.mtNear} />
      <path d="M380 150 Q540 40 700 150" fill="none" className={s.bridge} />
      <path d="M380 150H700" className={s.bridge} />
      <path d="M0 146H1080" className={s.lake} />
    </svg>
  );
}

const FLOW: { icon: keyof typeof ICONS; t: string; d: string }[] = [
  { icon: "calendar", t: "Gast bucht", d: "auf Ihrer Website, mit TWINT oder Karte" },
  { icon: "bed", t: "Rezeption", d: "Zimmer zuweisen, einchecken, Posten buchen" },
  { icon: "sparkle", t: "Reinigung", d: "Zimmer nach Abreise auf der Handy-Liste" },
  { icon: "invoice", t: "Rechnung", d: "MWST, QR-Rechnung, Kurtaxe, per Mail" },
  { icon: "table", t: "Buchhaltung", d: "Buchungsliste für Ihren Treuhänder" },
];

export function Bausteine({ staticSite }: { staticSite?: boolean }) {
  return (
    <>
      <section className={s.section} id="bausteine">
        <h2 className={s.h2}>Ein Baukasten: Sie nehmen, was Sie brauchen</h2>
        <p className={s.intro}>
          Der Kern, also Direktbuchung und Zahlung, ist immer dabei. Alles andere schalten Sie mit einem Klick ein oder aus. Ein Chalet braucht keine Rezeption, ein Hotel mit Team schon.
          Ausgeschaltetes verschwindet aus dem Menü, Ihre Daten bleiben erhalten.
        </p>
        <div className={s.buildWrap}><BuildGraphic /></div>
        <p className={s.buildNote}>Beispiel: Ein kleines Hotel schaltet Rezeption, Rechnung, Kurtaxe und Statistik ein. Das Chalet nebenan nur Rechnung und Kurtaxe.</p>
      </section>

      <section className={s.section} id="funktionen">
        <h2 className={s.h2}>Alles, was ein kleines Haus braucht</h2>
        <p className={s.intro}>Von der ersten Buchung bis zur Buchhaltung, an einem Ort und aus einer Hand.</p>
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
        <h2 className={s.h2}>Vom Klick bis zur Buchhaltung</h2>
        <p className={s.intro}>Eine Buchung läuft durch alle Stationen, ohne dass Sie etwas doppelt erfassen.</p>
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
