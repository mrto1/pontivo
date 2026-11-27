import { modulesForKind, type ModuleRow } from "./modules";

/**
 * Funktionspakete (SPEC 19.69): Vorauswahl für Einrichtung, Funktionen-Seite, Preise und Website.
 * Ein Paket schaltet mehrere Funktionen (Module) auf einmal; einzeln schalten bleibt unter «Funktionen» immer möglich.
 * Reine Logik ohne I/O.
 */
export type PackageKey = "basis" | "betrieb" | "vermietung" | "restaurant" | "kasse" | "wachstum" | "firmen";
export type Package = {
  key: PackageKey;
  name: string;
  /** Ein Satz: was das Paket bringt (Sprache der Gastgeber, keine Fachbegriffe) */
  promise: string;
  /** Für wen: Unterkunft, Gastronomie oder beide */
  for: "lodging" | "dining" | "both";
  modules: string[];
  /** Aufpreis, falls das Paket etwas kostet */
  price?: string;
  /** Nur für Verwalter ganzer Wohnungen */
  wholeUnitOnly?: boolean;
};

export const PACKAGES: Package[] = [
  { key: "basis", name: "Unterkunft Basis", for: "lodging", promise: "Website mit Direktbuchung, Kalender und Preise mit Abgleich zu Booking.com und Airbnb, Rechnung mit QR, Kurtaxe, Gutscheine und Statistik.", modules: ["invoicing", "statistics", "vouchers", "mailtexts", "inquiries", "feedback", "monthlymail", "google"] },
  { key: "betrieb", name: "Hotelbetrieb", for: "lodging", promise: "Rezeption mit Zimmerplan, Reinigung am Handy, Online-Check-in mit Meldeschein, Gästekartei, Gruppen und Nachrichten der Portale an einem Ort.", modules: ["frontdesk", "housekeeping", "guests", "guestnotes", "groups", "inbox"] },
  { key: "vermietung", name: "Ferienwohnungen verwalten", for: "lodging", wholeUnitOnly: true, promise: "Monatsabrechnung für die Eigentümer und Türcodes mit Nuki für jede Buchung.", modules: ["owners", "access"] },
  { key: "restaurant", name: "Restaurant", for: "both", promise: "Online-Reservation mit Tischplan, Speisekarte, Küchenbildschirm, Bestellen und Bezahlen am Tisch per QR und Online-Bestellung.", modules: ["restaurant", "guestnotes"] },
  { key: "kasse", name: "Restaurant-Kasse", for: "both", price: "CHF 29 pro Monat", promise: "Kassieren am Tablet mit bar, Karte, TWINT oder aufs Zimmer, getrennt zahlen und Kassenabschluss.", modules: ["restaurant", "pos"] },
  { key: "wachstum", name: "Mehr Direktbuchungen", for: "both", promise: "Preisempfehlung, Newsletter an Stammgäste und Google mit Buchen, Reservieren und Bestellen.", modules: ["pricing_rules", "marketing", "google"] },
  { key: "firmen", name: "Firmen und Treuhand", for: "both", promise: "Firmenkunden auf Rechnung mit Mahnungen und Export für den Treuhänder.", modules: ["debtors", "accountingexport"] },
];

export type Kind = { restaurantOnly: boolean; wholeUnit: boolean };

/** Pakete für diese Betriebsart; Funktionen, die es für die Betriebsart nicht gibt, fallen aus dem Paket */
export function packagesFor(kind: Kind): Package[] {
  const allowed = new Set(modulesForKind(kind));
  return PACKAGES
    .filter((p) => (kind.restaurantOnly ? p.for !== "lodging" : true) && (!p.wholeUnitOnly || kind.wholeUnit))
    .map((p) => ({ ...p, modules: p.modules.filter((m) => allowed.has(m)) }))
    .filter((p) => p.modules.length > 0);
}

/** Stand eines Pakets: alle, einige oder keine seiner Funktionen eingeschaltet */
export function packageState(p: Package, rows: ModuleRow[], isOn: (rows: ModuleRow[], key: string) => boolean): "on" | "partial" | "off" {
  const n = p.modules.filter((m) => isOn(rows, m)).length;
  return n === p.modules.length ? "on" : n ? "partial" : "off";
}

/**
 * Gewählte Pakete → gewünschte Funktionen: Funktionen gewählter Pakete an; Funktionen der angezeigten, nicht gewählten Pakete aus,
 * ausser ein gewähltes Paket enthält sie auch. Funktionen ausserhalb der Pakete bleiben unberührt.
 */
export function wantedFromPackages(shown: Package[], picked: string[]): Record<string, boolean> {
  const on = new Set(shown.filter((p) => picked.includes(p.key)).flatMap((p) => p.modules));
  const wanted: Record<string, boolean> = {};
  for (const p of shown) for (const m of p.modules) wanted[m] = on.has(m);
  return wanted;
}

/** Ein Paket ein- oder ausschalten; beim Ausschalten bleiben Funktionen an, die ein anderes, ganz eingeschaltetes Paket braucht */
export function wantedForToggle(shown: Package[], key: string, on: boolean, rows: ModuleRow[], isOn: (rows: ModuleRow[], key: string) => boolean): Record<string, boolean> {
  const p = shown.find((x) => x.key === key);
  if (!p) return {};
  if (on) return Object.fromEntries(p.modules.map((m) => [m, true]));
  const keep = new Set(shown.filter((x) => x.key !== key && packageState(x, rows, isOn) === "on").flatMap((x) => x.modules));
  return Object.fromEntries(p.modules.filter((m) => !keep.has(m)).map((m) => [m, false]));
}
