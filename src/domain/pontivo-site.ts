/**
 * Texte der Pontivo-Startseite: Standardwerte im Code, Änderungen im Plattform-Admin (`/plattform/website`) in der Datenbank.
 * Platzhalter in Texten: {name} = Plattformname, {fee} = Gebühr in Prozent, {emailTo} = « an <Kontakt-E-Mail>» (leer ohne Adresse).
 * Reine Logik ohne I/O.
 */
export type SiteField = { key: string; group: string; label: string; multiline: boolean; default: string };
export type FaqItem = { q: string; a: string };
export type SiteOverrides = { texts: Record<string, string>; faq: FaqItem[] | null };

export const SITE_FIELDS: SiteField[] = [
  {
    "key": "hero.title",
    "group": "Kopfbereich",
    "label": "Titel",
    "multiline": false,
    "default": "Mehr Gäste direkt, weniger Provision. Ein System für Ihr ganzes Haus."
  },
  {
    "key": "hero.lead",
    "group": "Kopfbereich",
    "label": "Einleitung",
    "multiline": true,
    "default": "{name} bringt Gäste von Google und Ihrer Website direkt zu Ihrer eigenen Buchung, mit TWINT und Karte. Dazu alles für den Betrieb: Kalender mit Abgleich zu Booking.com und Airbnb, Rezeption, Reinigung, Online-Check-in mit Meldeschein, Rechnung mit QR und Kurtaxe. Sie schalten nur ein, was Sie brauchen."
  },
  {
    "key": "hero.ctaMain",
    "group": "Kopfbereich",
    "label": "Knopf 1",
    "multiline": false,
    "default": "Jetzt loslegen"
  },
  {
    "key": "hero.ctaSecond",
    "group": "Kopfbereich",
    "label": "Knopf 2",
    "multiline": false,
    "default": "Gespräch vereinbaren"
  },
  {
    "key": "bausteine.title",
    "group": "Angebot (drei Wege)",
    "label": "Baukasten: Überschrift",
    "multiline": false,
    "default": "Ein Baukasten: Sie nehmen, was Sie brauchen"
  },
  {
    "key": "bausteine.intro",
    "group": "Angebot (drei Wege)",
    "label": "Baukasten: Einleitung",
    "multiline": true,
    "default": "Website, Direktbuchung und Zahlung sind immer dabei. Dazu wählen Sie Pakete wie «Unterkunft Basis», «Hotelbetrieb», «Ferienwohnungen verwalten», «Restaurant» oder «Mehr Direktbuchungen». Jede Funktion lässt sich auch einzeln ein- und ausschalten. Ein Chalet braucht keine Rezeption, ein Hotel mit Team schon. Ausgeschaltetes verschwindet aus dem Menü, Ihre Daten bleiben erhalten."
  },
  {
    "key": "web.title",
    "group": "Angebot (drei Wege)",
    "label": "Website: Überschrift",
    "multiline": false,
    "default": "Direktbuchung auf Ihrer eigenen Website, oder auf der von Pontivo"
  },
  {
    "key": "web.intro",
    "group": "Angebot (drei Wege)",
    "label": "Website: Einleitung",
    "multiline": true,
    "default": "Drei gleichwertige Wege. Buchung, Zahlung und der Abgleich mit Booking.com sind bei allen gleich. Auch der Wechsel von Ihrer heutigen Buchungsmaschine ist möglich: Statt einer festen Monatsgebühr zahlen Sie nur bei einer Buchung."
  },
  {
    "key": "web.1.title",
    "group": "Angebot (drei Wege)",
    "label": "Variante 1: Titel",
    "multiline": false,
    "default": "Neue Website von Pontivo"
  },
  {
    "key": "web.1.text",
    "group": "Angebot (drei Wege)",
    "label": "Variante 1: Text",
    "multiline": true,
    "default": "Eine Website, die zu Ihrem Haus passt, mit allen Möglichkeiten: Layout, Schrift, Farbe, Logo und Inhalte stellen Sie selbst ein, in bis zu fünf Sprachen (Deutsch, Englisch, Französisch, Italienisch, Niederländisch) mit Übersetzung auf Knopfdruck."
  },
  {
    "key": "web.1.bullets",
    "group": "Angebot (drei Wege)",
    "label": "Variante 1: Stichpunkte (eine Zeile pro Punkt)",
    "multiline": true,
    "default": "Alles aus einer Hand: Website, Buchung und Zahlung\nKeine zusätzlichen Unterhaltskosten für die Website\nUpdates und Wartung sind inklusive"
  },
  {
    "key": "web.2.title",
    "group": "Angebot (drei Wege)",
    "label": "Variante 2: Titel",
    "multiline": false,
    "default": "Einfache Einbindung auf Ihrer Website"
  },
  {
    "key": "web.2.text",
    "group": "Angebot (drei Wege)",
    "label": "Variante 2: Text",
    "multiline": true,
    "default": "Ihre Seite bleibt. Ein «Jetzt buchen»-Knopf, eine Suchleiste oder die ganze Buchungsstrecke wird eingebaut, mit Zahlung ohne Seitenwechsel. Logo und Farben übernehmen wir."
  },
  {
    "key": "web.2.bullets",
    "group": "Angebot (drei Wege)",
    "label": "Variante 2: Stichpunkte (eine Zeile pro Punkt)",
    "multiline": true,
    "default": "Funktioniert mit Wix, WordPress, Jimdo und jeder anderen Website\nEinfachste Variante: den bestehenden «Buchen»-Link umstellen\nKein Relaunch, keine neue Agentur"
  },
  {
    "key": "web.3.title",
    "group": "Angebot (drei Wege)",
    "label": "Variante 3: Titel",
    "multiline": false,
    "default": "Volle Integration auf Ihrer Website"
  },
  {
    "key": "web.3.text",
    "group": "Angebot (drei Wege)",
    "label": "Variante 3: Text",
    "multiline": true,
    "default": "Suche, Preise, Buchung, Änderung und Storno laufen über unsere API, die Oberfläche gestalten Sie vollständig selbst."
  },
  {
    "key": "web.3.bullets",
    "group": "Angebot (drei Wege)",
    "label": "Variante 3: Stichpunkte (eine Zeile pro Punkt)",
    "multiline": true,
    "default": "Eigenes Design bis ins Detail\nDank KI-Assistenten heute in Tagen statt Monaten umgesetzt\nAuch ohne eigenes Entwicklerteam möglich"
  },
  {
    "key": "funktionen.title",
    "group": "Baukasten und Funktionen",
    "label": "Funktionen: Überschrift",
    "multiline": false,
    "default": "Alles, was Sie als Gastgeber brauchen"
  },
  {
    "key": "funktionen.intro",
    "group": "Baukasten und Funktionen",
    "label": "Funktionen: Einleitung",
    "multiline": true,
    "default": "Von der ersten Buchung bis zur Buchhaltung, an einem Ort und aus einer Hand."
  },
  {
    "key": "ablaufgast.title",
    "group": "Baukasten und Funktionen",
    "label": "Ablauf: Überschrift",
    "multiline": false,
    "default": "Vom Klick bis zur Buchhaltung"
  },
  {
    "key": "ablaufgast.intro",
    "group": "Baukasten und Funktionen",
    "label": "Ablauf: Einleitung",
    "multiline": true,
    "default": "Eine Buchung läuft durch alle Stationen, ohne dass Sie etwas doppelt erfassen."
  },
  {
    "key": "ablauf.title",
    "group": "In drei Schritten",
    "label": "Überschrift",
    "multiline": false,
    "default": "In drei Schritten zur eigenen Direktbuchung"
  },
  {
    "key": "ablauf.intro",
    "group": "In drei Schritten",
    "label": "Einleitung",
    "multiline": true,
    "default": "Sie müssen nichts installieren. Der Einrichtungs-Assistent führt Sie Schritt für Schritt, und auf Wunsch übernimmt die KI Texte, Zimmer und Fotos aus Ihrer bisherigen Website. Lieber mit Unterstützung? Dann richten wir es gemeinsam mit Ihnen ein."
  },
  {
    "key": "step.1.title",
    "group": "In drei Schritten",
    "label": "Schritt 1: Titel",
    "multiline": false,
    "default": "Registrieren"
  },
  {
    "key": "step.1.text",
    "group": "In drei Schritten",
    "label": "Schritt 1: Text",
    "multiline": true,
    "default": "Konto eröffnen, Betriebsart wählen und die passenden Pakete ankreuzen. Das dauert wenige Minuten und kostet nichts, solange Sie nicht online sind."
  },
  {
    "key": "step.2.title",
    "group": "In drei Schritten",
    "label": "Schritt 2: Titel",
    "multiline": false,
    "default": "Einrichten"
  },
  {
    "key": "step.2.text",
    "group": "In drei Schritten",
    "label": "Schritt 2: Text",
    "multiline": true,
    "default": "Zimmer, Preise, Fotos, Zahlungskonto und Abgleich mit Booking.com: Der Assistent zeigt bei jedem Schritt, was noch fehlt. Je nach Weg kommt der Buchungsknopf auf Ihre Website oder Sie nutzen die neue Website."
  },
  {
    "key": "step.3.title",
    "group": "In drei Schritten",
    "label": "Schritt 3: Titel",
    "multiline": false,
    "default": "Gäste buchen direkt"
  },
  {
    "key": "step.3.text",
    "group": "In drei Schritten",
    "label": "Schritt 3: Text",
    "multiline": true,
    "default": "Wer Sie auf Google oder Ihrer Website findet, bucht direkt bei Ihnen und bezahlt sofort. Das Geld kommt direkt auf Ihr Konto."
  },
  {
    "key": "vorteile.title",
    "group": "Vorteile",
    "label": "Überschrift",
    "multiline": false,
    "default": "Was Sie davon haben"
  },
  {
    "key": "benefit.1.title",
    "group": "Vorteile",
    "label": "Vorteil 1: Titel",
    "multiline": false,
    "default": "{fee} % statt 15–18 %"
  },
  {
    "key": "benefit.1.text",
    "group": "Vorteile",
    "label": "Vorteil 1: Text",
    "multiline": true,
    "default": "Für jede Buchung, die über Google oder Ihre Website direkt statt übers Portal kommt, bleibt der Grossteil der Provision bei Ihnen."
  },
  {
    "key": "benefit.2.title",
    "group": "Vorteile",
    "label": "Vorteil 2: Titel",
    "multiline": false,
    "default": "Geld direkt auf Ihr Konto"
  },
  {
    "key": "benefit.2.text",
    "group": "Vorteile",
    "label": "Vorteil 2: Text",
    "multiline": true,
    "default": "Die Zahlung läuft über Stripe auf Ihr eigenes Konto. Wir halten nie Geld Ihrer Gäste."
  },
  {
    "key": "benefit.3.title",
    "group": "Vorteile",
    "label": "Vorteil 3: Titel",
    "multiline": false,
    "default": "TWINT, Karte, Apple Pay, Google Pay"
  },
  {
    "key": "benefit.3.text",
    "group": "Vorteile",
    "label": "Vorteil 3: Text",
    "multiline": true,
    "default": "Gäste bezahlen so, wie sie es gewohnt sind – auch auf dem Handy in wenigen Sekunden."
  },
  {
    "key": "benefit.4.title",
    "group": "Vorteile",
    "label": "Vorteil 4: Titel",
    "multiline": false,
    "default": "Booking.com und Airbnb laufen weiter"
  },
  {
    "key": "benefit.4.text",
    "group": "Vorteile",
    "label": "Vorteil 4: Text",
    "multiline": true,
    "default": "Freie Zimmer und Preise werden automatisch abgeglichen. Buchungen aus dem Portal erscheinen ebenfalls bei Ihnen. Doppelbuchungen werden sofort gemeldet."
  },
  {
    "key": "benefit.5.title",
    "group": "Vorteile",
    "label": "Vorteil 5: Titel",
    "multiline": false,
    "default": "Kurtaxe richtig berechnet"
  },
  {
    "key": "benefit.5.text",
    "group": "Vorteile",
    "label": "Vorteil 5: Text",
    "multiline": true,
    "default": "Die Kurtaxe Ihrer Gemeinde wird je nach Alter der Gäste automatisch ausgewiesen."
  },
  {
    "key": "benefit.6.title",
    "group": "Vorteile",
    "label": "Vorteil 6: Titel",
    "multiline": false,
    "default": "Stornos ohne Telefonate"
  },
  {
    "key": "benefit.6.text",
    "group": "Vorteile",
    "label": "Vorteil 6: Text",
    "multiline": true,
    "default": "Gäste stornieren selbst über ihren Buchungslink. Die Rückerstattung nach Ihren Bedingungen läuft automatisch."
  },
  {
    "key": "benefit.7.title",
    "group": "Vorteile",
    "label": "Vorteil 7: Titel",
    "multiline": false,
    "default": "Ein System statt fünf"
  },
  {
    "key": "benefit.7.text",
    "group": "Vorteile",
    "label": "Vorteil 7: Text",
    "multiline": true,
    "default": "Website, Buchung, Kalender, Rezeption, Reinigung, Online-Check-in mit Meldeschein, Rechnung mit QR und Tagesabschluss. Einfach genug, dass auch Mitarbeitende damit arbeiten."
  },
  {
    "key": "benefit.8.title",
    "group": "Vorteile",
    "label": "Vorteil 8: Titel",
    "multiline": false,
    "default": "Günstiger direkt anbieten ist erlaubt"
  },
  {
    "key": "benefit.8.text",
    "group": "Vorteile",
    "label": "Vorteil 8: Text",
    "multiline": true,
    "default": "Seit Dezember 2022 dürfen Schweizer Hotels auf der eigenen Website tiefere Preise verlangen als auf Portalen."
  },
  {
    "key": "rechner.title",
    "group": "Rechner",
    "label": "Überschrift",
    "multiline": false,
    "default": "Rechnen Sie selbst"
  },
  {
    "key": "rechner.intro",
    "group": "Rechner",
    "label": "Einleitung",
    "multiline": true,
    "default": "Schieben Sie die Regler auf Ihre Zahlen. Der Rechner zeigt, wie viel Provision zusätzlich bei Ihnen bleibt."
  },
  {
    "key": "preis.title",
    "group": "Preis",
    "label": "Überschrift",
    "multiline": false,
    "default": "Sie zahlen nur, wenn Gäste direkt buchen"
  },
  {
    "key": "preis.1",
    "group": "Preis",
    "label": "Punkt 1",
    "multiline": false,
    "default": "{fee} % pro Direktbuchung, automatisch bei der Zahlung abgezogen"
  },
  {
    "key": "preis.2",
    "group": "Preis",
    "label": "Punkt 2",
    "multiline": false,
    "default": "Mindestens CHF 19 pro Monat: Liegen die {fee} % darunter, wird nur die Differenz belastet"
  },
  {
    "key": "preis.3",
    "group": "Preis",
    "label": "Punkt 3",
    "multiline": false,
    "default": "Keine Einrichtungsgebühr, monatlich kündbar"
  },
  {
    "key": "preis.4",
    "group": "Preis",
    "label": "Punkt 4",
    "multiline": false,
    "default": "Bei Stornierung wird die Gebühr anteilig zurückerstattet"
  },
  {
    "key": "preis.5",
    "group": "Preis",
    "label": "Punkt 5",
    "multiline": false,
    "default": "Buchungen über Booking.com & Co. kosten bei uns nichts"
  },
  {
    "key": "preis.6",
    "group": "Preis",
    "label": "Punkt 6",
    "multiline": false,
    "default": "Zahlungsgebühren von Stripe gehen wie bei jedem Kartenterminal zu Ihren Lasten"
  },
  {
    "key": "fragen.title",
    "group": "Häufige Fragen",
    "label": "Überschrift",
    "multiline": false,
    "default": "Häufige Fragen"
  },
  {
    "key": "kontakt.title",
    "group": "Kontakt",
    "label": "Überschrift",
    "multiline": false,
    "default": "Schauen wir uns Ihr Hotel gemeinsam an"
  },
  {
    "key": "kontakt.text",
    "group": "Kontakt",
    "label": "Text",
    "multiline": true,
    "default": "Im ersten Gespräch zeigen wir Ihnen, wie Ihre Website mit Direktbuchung aussehen würde und was Sie damit sparen. Unverbindlich und kostenlos."
  },
  {
    "key": "foot.tagline",
    "group": "Fusszeile",
    "label": "Zeile",
    "multiline": false,
    "default": "Direktbuchung und Hotelbetrieb für Unterkünfte in der Schweiz · Server und Datenbank bei Infomaniak in Genf"
  }
];

export const DEFAULT_FAQ: FaqItem[] = [
  {
    "q": "Muss ich alle Funktionen nutzen?",
    "a": "Nein. Direktbuchung und Zahlung sind der Kern. Dazu wählen Sie Pakete, etwa «Hotelbetrieb» mit Rezeption, Reinigung und Online-Check-in, oder schalten jede Funktion einzeln ein oder aus. Was Sie nicht brauchen, sehen Sie nicht, und Ihre Daten bleiben erhalten."
  },
  {
    "q": "Ersetzt {name} meine Hotelsoftware?",
    "a": "Bei kleinen und mittleren Häusern in der Regel ja: Rezeption, Zimmerplan, Reinigung, Rechnung mit QR-Rechnung, Kurtaxe und Buchhaltungs-Export sind eingebaut. Haben Sie ein Restaurant mit eigener Kasse oder brauchen Sie etwas, das wir noch nicht haben, läuft Ihre bisherige Software einfach daneben weiter."
  },
  {
    "q": "Muss ich Booking.com kündigen?",
    "a": "Nein. Booking.com bleibt ein wichtiger Kanal für neue Gäste. {name} sorgt dafür, dass Gäste, die Sie bereits kennen oder auf Google finden, direkt buchen können: mit den Links für Ihr Google-Unternehmensprofil und, sobald freigeschaltet, mit Ihrem eigenen Preis in der Hotelsuche von Google."
  },
  {
    "q": "Darf ich auf meiner Website günstiger sein als auf Booking.com?",
    "a": "Ja. Seit dem 1. Dezember 2022 sind Klauseln verboten, die Schweizer Hotels daran hindern, auf der eigenen Website tiefere Preise anzubieten."
  },
  {
    "q": "Was passiert mit meiner bestehenden Website?",
    "a": "Sie bleibt, wenn Sie möchten. Wir fügen nur einen Buchungs-Knopf oder eine Suchleiste ein, oder Sie stellen Ihren bestehenden «Buchen»-Link um. Wünschen Sie eine neue Website, übernehmen wir Ihre Inhalte und Fotos unter Ihrer bisherigen Domain."
  },
  {
    "q": "Ich habe schon eine Buchungsmaschine. Lohnt sich ein Wechsel?",
    "a": "Das hängt davon ab, was Sie heute zahlen und wie viele Direktbuchungen Sie haben. Wir rechnen es im ersten Gespräch mit Ihren Zahlen durch – mit {name} zahlen Sie nur, wenn tatsächlich gebucht wird."
  },
  {
    "q": "Ich habe schon eine Hotelsoftware oder einen Channel-Manager. Geht das trotzdem?",
    "a": "In vielen Fällen ja. Wir prüfen im ersten Gespräch, wie Ihre Software angebunden werden kann."
  },
  {
    "q": "Wo sind die Daten meiner Gäste?",
    "a": "Server und Datenbank von {name} stehen in der Schweiz (Infomaniak, Genf). Gastdaten bearbeiten wir in Ihrem Auftrag nach Schweizer Datenschutzgesetz. Kartendaten sehen weder wir noch Sie – die verarbeitet ausschliesslich der Zahlungsdienst Stripe. Für den E-Mail-Versand nutzen wir Postmark; die Dienstleister stehen in der Datenschutzerklärung."
  },
  {
    "q": "Wie kann ich kündigen?",
    "a": "Jederzeit per E-Mail mit 30 Tagen Frist auf Ende eines Monats. Es gibt keine Mindestlaufzeit und keine Einrichtungsgebühr. Bestehende Buchungen Ihrer Gäste werden bis zur Abreise normal abgewickelt, und Sie können Ihre Daten während 30 Tagen exportieren."
  },
  {
    "q": "Was passiert bei Stornierungen, Rückerstattungen und Rückbuchungen?",
    "a": "Storniert ein Gast, gilt die Stornoregel Ihres Betriebs; die Rückerstattung läuft automatisch über Stripe, und unsere Gebühr von {fee} % wird anteilig zurückerstattet. Ficht ein Gast eine Kartenzahlung an (Rückbuchung), klären Sie das als Verkäufer direkt in Ihrem Stripe-Konto, wir unterstützen Sie dabei. Fragen zu einer Abrechnung von {name} beantworten wir per E-Mail{emailTo}; zu Unrecht belastete Beträge erstatten wir zurück."
  },
  {
    "q": "Wer ist Vertragspartner des Gastes?",
    "a": "Immer Ihr Hotel. {name} stellt nur die Technik zur Verfügung und ist weder Reiseveranstalter noch Vermittler mit eigener Provision auf Ihren Zimmerpreis."
  }
];

export const MAX_TEXT = 1500;
export const MAX_FAQ = 30;

export type SiteVars = { name: string; fee: string | number; email?: string };

export function fill(text: string, v: SiteVars): string {
  return text.replaceAll("{name}", v.name).replaceAll("{fee}", String(v.fee)).replaceAll("{emailTo}", v.email ? ` an ${v.email}` : "");
}

const DEFAULTS = new Map(SITE_FIELDS.map((f) => [f.key, f.default]));
export const isSiteKey = (k: string) => DEFAULTS.has(k);

/** Aufgelöster Inhalt: Überschreibung, sonst Standard (leere Überschreibung zählt als Standard) */
export function resolveSite(o: SiteOverrides | null, vars: SiteVars) {
  const text = (key: string) => fill((o?.texts[key]?.trim() ? o.texts[key] : DEFAULTS.get(key)) ?? "", vars);
  const faq = (o?.faq && o.faq.length ? o.faq : DEFAULT_FAQ).map((f) => ({ q: fill(f.q, vars), a: fill(f.a, vars) }));
  const lines = (key: string) => text(key).split("\n").map((x) => x.trim()).filter(Boolean);
  return { text, lines, faq };
}
export type ResolvedSite = ReturnType<typeof resolveSite>;

/** Eingaben aus dem Editor bereinigen: nur bekannte Schlüssel, leer oder gleich wie der Standard = keine Überschreibung */
export function cleanOverrides(input: { texts: Record<string, string>; faq: FaqItem[] }): SiteOverrides {
  const texts: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.texts)) {
    if (!isSiteKey(k)) continue;
    const t = v.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT);
    if (t && t !== DEFAULTS.get(k)) texts[k] = t;
  }
  const faq = input.faq
    .map((f) => ({ q: f.q.trim().slice(0, 300), a: f.a.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT) }))
    .filter((f) => f.q && f.a)
    .slice(0, MAX_FAQ);
  const same = faq.length === DEFAULT_FAQ.length && faq.every((f, i) => f.q === DEFAULT_FAQ[i].q && f.a === DEFAULT_FAQ[i].a);
  return { texts, faq: same || faq.length === 0 ? null : faq };
}
