import type { Locale } from "./dict";

export type PreorderText = { title: string; hint: () => string; required: (n: number) => string; qty: string; total: string; note: string };
export const PRE: Record<Locale, PreorderText> = {
  de: { title: "Vorbestellung", hint: () => "Wählen Sie Gerichte schon jetzt. Sie bezahlen die Vorbestellung online, sie wird auf Ihre Rechnung angerechnet; bei Stornierung rechtzeitig vor dem Termin erhalten Sie das Geld zurück.", required: (n) => `Ab ${n} Personen ist eine Vorbestellung nötig.`, qty: "Anzahl", total: "Summe", note: "Sonderwunsch" },
  en: { title: "Pre-order", hint: () => "Choose dishes now. You pay the pre-order online and it is credited on your bill; if you cancel in time before the date it is refunded.", required: (n) => `A pre-order is required for parties of ${n} or more.`, qty: "Quantity", total: "Total", note: "Special request" },
  fr: { title: "Précommande", hint: () => "Choisissez dès maintenant vos plats. Vous payez la précommande en ligne, elle est déduite de votre addition ; en cas d'annulation dans les délais, elle est remboursée.", required: (n) => `Une précommande est nécessaire à partir de ${n} personnes.`, qty: "Quantité", total: "Total", note: "Souhait particulier" },
  it: { title: "Preordine", hint: () => "Scegliete i piatti già ora. Pagate il preordine online e viene detratto dal conto; con un annullamento tempestivo viene rimborsato.", required: (n) => `Da ${n} persone è necessario un preordine.`, qty: "Quantità", total: "Totale", note: "Richiesta speciale" },
  nl: { title: "Voorbestelling", hint: () => "Kies nu al uw gerechten. U betaalt de voorbestelling online en ze wordt van uw rekening afgetrokken; bij tijdige annulering krijgt u het geld terug.", required: (n) => `Vanaf ${n} personen is een voorbestelling nodig.`, qty: "Aantal", total: "Totaal", note: "Speciaal verzoek" },
};
