import type { Locale } from "./dict";

/** Texte der Bewertungsfrage nach dem Aufenthalt (SPEC 19.2) */
export type FeedbackText = {
  mailText: string; mailButton: string; bookAgain: string;
  title: string; intro: string; scoreLabel: string; commentLabel: string; send: string;
  thanksPublic: string; publicButton: string; thanksInternal: string; already: string; invalid: string;
  scores: [string, string, string, string, string];
};

export const F: Record<Locale, FeedbackText> = {
  de: {
    mailText: "wie war Ihr Aufenthalt? Eine kurze Rückmeldung (eine Minute) hilft uns sehr.", mailButton: "Aufenthalt bewerten", bookAgain: "Beim nächsten Mal direkt buchen",
    title: "Wie war Ihr Aufenthalt?", intro: "Ihre Rückmeldung geht direkt an das Haus.", scoreLabel: "Ihre Note", commentLabel: "Was können wir besser machen? (freiwillig)", send: "Absenden",
    thanksPublic: "Vielen Dank, das freut uns sehr! Wenn Sie mögen, helfen Sie anderen Gästen mit einer öffentlichen Bewertung.", publicButton: "Öffentlich bewerten",
    thanksInternal: "Vielen Dank für Ihre ehrliche Rückmeldung. Wir haben sie ans Haus weitergeleitet und melden uns bei Bedarf.", already: "Sie haben schon eine Rückmeldung abgegeben. Vielen Dank!", invalid: "Bitte wählen Sie eine Note von 1 bis 5.",
    scores: ["Schlecht", "Mässig", "In Ordnung", "Gut", "Sehr gut"],
  },
  en: {
    mailText: "how was your stay? A short reply (one minute) helps us a lot.", mailButton: "Rate your stay", bookAgain: "Book direct next time",
    title: "How was your stay?", intro: "Your feedback goes straight to the property.", scoreLabel: "Your rating", commentLabel: "What could we do better? (optional)", send: "Send",
    thanksPublic: "Thank you, we are delighted! If you like, help other guests with a public review.", publicButton: "Leave a public review",
    thanksInternal: "Thank you for your honest feedback. We have passed it on to the property and will get back to you if needed.", already: "You have already given feedback. Thank you!", invalid: "Please choose a rating from 1 to 5.",
    scores: ["Poor", "Fair", "OK", "Good", "Very good"],
  },
  fr: {
    mailText: "comment s'est passé votre séjour ? Un court retour (une minute) nous aide beaucoup.", mailButton: "Évaluer votre séjour", bookAgain: "La prochaine fois, réservez en direct",
    title: "Comment s'est passé votre séjour ?", intro: "Votre avis va directement à l'établissement.", scoreLabel: "Votre note", commentLabel: "Que pouvons-nous améliorer ? (facultatif)", send: "Envoyer",
    thanksPublic: "Merci, cela nous fait très plaisir ! Si vous le souhaitez, aidez d'autres clients avec un avis public.", publicButton: "Laisser un avis public",
    thanksInternal: "Merci pour votre retour sincère. Nous l'avons transmis à l'établissement et vous répondrons si nécessaire.", already: "Vous avez déjà donné votre avis. Merci !", invalid: "Veuillez choisir une note de 1 à 5.",
    scores: ["Mauvais", "Moyen", "Correct", "Bien", "Très bien"],
  },
  it: {
    mailText: "com'è andato il vostro soggiorno? Un breve riscontro (un minuto) ci aiuta molto.", mailButton: "Valuta il soggiorno", bookAgain: "La prossima volta prenotate direttamente",
    title: "Com'è andato il vostro soggiorno?", intro: "Il vostro parere va direttamente alla struttura.", scoreLabel: "Il vostro voto", commentLabel: "Cosa possiamo migliorare? (facoltativo)", send: "Invia",
    thanksPublic: "Grazie, ci fa molto piacere! Se volete, aiutate altri ospiti con una recensione pubblica.", publicButton: "Lascia una recensione pubblica",
    thanksInternal: "Grazie per il vostro riscontro sincero. L'abbiamo inoltrato alla struttura e vi risponderemo se necessario.", already: "Avete già dato il vostro parere. Grazie!", invalid: "Scegliete un voto da 1 a 5.",
    scores: ["Scarso", "Mediocre", "Discreto", "Buono", "Ottimo"],
  },
  nl: {
    mailText: "hoe was uw verblijf? Een korte reactie (een minuut) helpt ons enorm.", mailButton: "Beoordeel uw verblijf", bookAgain: "Boek de volgende keer direct",
    title: "Hoe was uw verblijf?", intro: "Uw reactie gaat rechtstreeks naar het huis.", scoreLabel: "Uw cijfer", commentLabel: "Wat kunnen we beter doen? (optioneel)", send: "Versturen",
    thanksPublic: "Hartelijk dank, dat doet ons veel plezier! Helpt u andere gasten graag met een openbare beoordeling?", publicButton: "Openbaar beoordelen",
    thanksInternal: "Dank voor uw eerlijke reactie. We hebben die doorgestuurd naar het huis en reageren zo nodig.", already: "U heeft al een reactie gegeven. Dank u!", invalid: "Kies een cijfer van 1 tot 5.",
    scores: ["Slecht", "Matig", "Redelijk", "Goed", "Zeer goed"],
  },
};
