import type { Locale } from "./dict";

/** Texte der Upselling-Seite und -Mails für Gäste (SPEC 14d) */
export type UpsellText = {
  title: string; intro: string; qty: string; total: string; pay: string; none: string; thanks: string; back: string; noteIncluded: string;
  perBooking: string; perNight: string; perPerson: string; perPersonNight: string; unavailable: string;
  mailSubject: (h: string) => string; mailText: string; mailButton: string; paidSubject: (h: string) => string; paidText: (amount: string) => string;
};

export const U: Record<Locale, UpsellText> = {
  de: {
    title: "Machen Sie Ihren Aufenthalt besonders", intro: "Vor Ihrer Anreise können Sie hier Extras dazubuchen. Die Zahlung geht direkt an das Haus.", qty: "Anzahl", total: "Total", pay: "Jetzt bezahlen",
    none: "Zurzeit gibt es keine Extras zur Auswahl.", thanks: "Vielen Dank, Ihre Extras sind bestellt und bezahlt.", back: "Zurück zur Buchung", noteIncluded: "Wählen Sie mindestens ein Extra.",
    perBooking: "pro Buchung", perNight: "pro Nacht", perPerson: "pro Person", perPersonNight: "pro Person und Nacht", unavailable: "Extras sind für diese Buchung nicht mehr verfügbar.",
    mailSubject: (h) => `Extras für Ihren Aufenthalt – ${h}`, mailText: "in Kürze reisen Sie an. Wenn Sie möchten, können Sie schon jetzt Extras für Ihren Aufenthalt dazubuchen.", mailButton: "Extras ansehen",
    paidSubject: (h) => `Ihre Extras – ${h}`, paidText: (a) => `vielen Dank für Ihre Bestellung über ${a}. Wir freuen uns auf Sie.`,
  },
  en: {
    title: "Make your stay special", intro: "Before you arrive, you can add extras here. Payment goes directly to the property.", qty: "Quantity", total: "Total", pay: "Pay now",
    none: "There are no extras available right now.", thanks: "Thank you, your extras are ordered and paid.", back: "Back to booking", noteIncluded: "Please choose at least one extra.",
    perBooking: "per booking", perNight: "per night", perPerson: "per person", perPersonNight: "per person and night", unavailable: "Extras are no longer available for this booking.",
    mailSubject: (h) => `Extras for your stay – ${h}`, mailText: "you arrive soon. If you like, you can add extras to your stay now.", mailButton: "View extras",
    paidSubject: (h) => `Your extras – ${h}`, paidText: (a) => `thank you for your order of ${a}. We look forward to seeing you.`,
  },
  fr: {
    title: "Rendez votre séjour unique", intro: "Avant votre arrivée, vous pouvez ajouter des extras ici. Le paiement va directement à l'établissement.", qty: "Quantité", total: "Total", pay: "Payer maintenant",
    none: "Aucun extra n'est disponible pour le moment.", thanks: "Merci, vos extras sont commandés et payés.", back: "Retour à la réservation", noteIncluded: "Veuillez choisir au moins un extra.",
    perBooking: "par réservation", perNight: "par nuit", perPerson: "par personne", perPersonNight: "par personne et par nuit", unavailable: "Les extras ne sont plus disponibles pour cette réservation.",
    mailSubject: (h) => `Extras pour votre séjour – ${h}`, mailText: "vous arrivez bientôt. Si vous le souhaitez, vous pouvez dès maintenant ajouter des extras à votre séjour.", mailButton: "Voir les extras",
    paidSubject: (h) => `Vos extras – ${h}`, paidText: (a) => `merci pour votre commande de ${a}. Nous nous réjouissons de vous accueillir.`,
  },
  it: {
    title: "Rendete speciale il vostro soggiorno", intro: "Prima dell'arrivo potete aggiungere degli extra. Il pagamento va direttamente alla struttura.", qty: "Quantità", total: "Totale", pay: "Paga ora",
    none: "Al momento non ci sono extra disponibili.", thanks: "Grazie, i vostri extra sono ordinati e pagati.", back: "Torna alla prenotazione", noteIncluded: "Scegliete almeno un extra.",
    perBooking: "per prenotazione", perNight: "per notte", perPerson: "per persona", perPersonNight: "per persona e notte", unavailable: "Gli extra non sono più disponibili per questa prenotazione.",
    mailSubject: (h) => `Extra per il vostro soggiorno – ${h}`, mailText: "arriverete a breve. Se lo desiderate, potete aggiungere subito degli extra al vostro soggiorno.", mailButton: "Vedi gli extra",
    paidSubject: (h) => `I vostri extra – ${h}`, paidText: (a) => `grazie per il vostro ordine di ${a}. Vi aspettiamo con piacere.`,
  },
  nl: {
    title: "Maak uw verblijf bijzonder", intro: "Voor uw aankomst kunt u hier extra's bijboeken. De betaling gaat rechtstreeks naar het huis.", qty: "Aantal", total: "Totaal", pay: "Nu betalen",
    none: "Er zijn momenteel geen extra's beschikbaar.", thanks: "Dank u, uw extra's zijn besteld en betaald.", back: "Terug naar de boeking", noteIncluded: "Kies minstens één extra.",
    perBooking: "per boeking", perNight: "per nacht", perPerson: "per persoon", perPersonNight: "per persoon en nacht", unavailable: "Extra's zijn voor deze boeking niet meer beschikbaar.",
    mailSubject: (h) => `Extra's voor uw verblijf – ${h}`, mailText: "u komt binnenkort aan. Als u wilt, kunt u nu extra's aan uw verblijf toevoegen.", mailButton: "Extra's bekijken",
    paidSubject: (h) => `Uw extra's – ${h}`, paidText: (a) => `hartelijk dank voor uw bestelling van ${a}. Wij kijken uit naar uw komst.`,
  },
};
