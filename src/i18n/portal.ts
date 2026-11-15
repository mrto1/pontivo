import type { Locale } from "./dict";

/** Texte des Gästeportals (SPEC 19.13). FR/IT/NL: Muttersprachler-Prüfung offen (QUESTIONS.md). */
export type PortalText = { infoTitle: string; extrasTitle: string; extrasText: string; extrasButton: string; calendar: string };

export const PORTAL: Record<Locale, PortalText> = {
  de: { infoTitle: "Infos zu Ihrem Aufenthalt", extrasTitle: "Extras dazubuchen", extrasText: "Frühstück, Spätanreise oder andere Extras – bezahlen Sie online, die Zahlung geht direkt an das Haus.", extrasButton: "Extras ansehen", calendar: "Zum Kalender hinzufügen" },
  en: { infoTitle: "Information for your stay", extrasTitle: "Add extras", extrasText: "Breakfast, late arrival or other extras – pay online, the payment goes directly to the property.", extrasButton: "View extras", calendar: "Add to calendar" },
  fr: { infoTitle: "Informations pour votre séjour", extrasTitle: "Ajouter des extras", extrasText: "Petit-déjeuner, arrivée tardive ou autres extras – payez en ligne, le paiement va directement à l'établissement.", extrasButton: "Voir les extras", calendar: "Ajouter au calendrier" },
  it: { infoTitle: "Informazioni per il suo soggiorno", extrasTitle: "Aggiungere extra", extrasText: "Colazione, arrivo tardivo o altri extra: pagamento online, direttamente alla struttura.", extrasButton: "Vedere gli extra", calendar: "Aggiungi al calendario" },
  nl: { infoTitle: "Informatie voor uw verblijf", extrasTitle: "Extra's toevoegen", extrasText: "Ontbijt, late aankomst of andere extra's – online betalen, de betaling gaat rechtstreeks naar het verblijf.", extrasButton: "Extra's bekijken", calendar: "Aan agenda toevoegen" },
};
