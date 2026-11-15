/**
 * Eignungs-Check (SPEC 19.14, PMS-ERSATZ 4.1): drei Fragen, drei Antworten. Reine Logik.
 * Die Antwort verspricht nie mehr, als Pontivo heute kann: Kassenschnittstelle und Kassenmodul gibt es, die Datenübernahme ist noch in Vorbereitung.
 */
export const MAX_ROOMS = 40;
export const SOFTWARE = ["none", "small", "large", "channel"] as const;
export type Software = (typeof SOFTWARE)[number];
export const SOFTWARE_LABEL: Record<Software, string> = {
  none: "Keine (Papier, Excel, Kalender)",
  small: "Hotelsoftware für kleine und mittlere Häuser",
  large: "Hotelsoftware für grosse Häuser oder Ketten (Kasse, Bankett, Schlüsselkarten, Telefonanlage angebunden)",
  channel: "Nur ein Channel-Manager oder Buchungsportale",
};

export type Fit = "fits" | "with_pos" | "alongside";
export type FitResult = { fit: Fit; title: string; text: string; reasons: string[] };

export function suitability(i: { rooms: number; restaurantWithPos: boolean; software: Software }): FitResult {
  const reasons: string[] = [];
  if (i.rooms > MAX_ROOMS) reasons.push(`Mehr als ${MAX_ROOMS} Zimmer: Pontivo ist für kleine und mittlere Häuser gebaut.`);
  if (i.software === "large") reasons.push("Ihre heutige Software deckt Bereiche ab (Kasse, Bankett, Schlüsselkarten, Telefonanlage), die Pontivo nicht ersetzt.");
  if (reasons.length) {
    return {
      fit: "alongside", title: "Pontivo läuft daneben",
      text: "Die Direktbuchung mit Zahlung und der Kanalabgleich lassen sich trotzdem nutzen. Ihre bisherige Software bleibt für den Rest bestehen.", reasons,
    };
  }
  if (i.restaurantWithPos) {
    return {
      fit: "with_pos", title: "Passt, mit Kassen-Schnittstelle oder Kassenmodul",
      text: "Pontivo ersetzt die Hotelseite. Für das Restaurant haben Sie zwei Wege: Ihre Kasse behalten und Posten über die Kassen-Schnittstelle aufs Zimmer buchen lassen (Ihr Kassenanbieter muss sie anbinden), oder das Kassenmodul von Pontivo nutzen (Bestellen am Tisch, bar, Karte und TWINT, aufs Zimmer, auch ohne Internet). Karte und TWINT bestätigt das Personal von Hand, Bons drucken und die Anbindung eines Kartenterminals gibt es noch nicht. Ihr Treuhänder sollte das Kassenmodul vor dem Einsatz prüfen.",
      reasons: ["Restaurant mit eigener Kasse."],
    };
  }
  const start = i.software === "none"
    ? "Sie starten ohne Datenübernahme."
    : "Die geführte Übernahme Ihrer Daten aus der bisherigen Software ist in Vorbereitung. Bis dahin starten Sie parallel: neue Buchungen laufen in Pontivo, bestehende erfassen Sie von Hand oder lassen sie in der alten Software auslaufen.";
  return {
    fit: "fits", title: "Passt: Pontivo kann Ihre Software in der Regel ersetzen",
    text: `Buchungen, Kanäle, Rechnungen, Kurtaxe, Meldeschein und Reinigung sind abgedeckt. ${start}`,
    reasons: [],
  };
}
