import type { Locale } from "./dict";

/** Texte der öffentlichen Online-Bestellung (SPEC 20.4/20.5) */
export type OrdText = {
  title: string; closed: string; pickup: string; delivery: string; add: string; cart: string; empty: string; subtotal: string; deliveryFee: string; total: string;
  time: string; asap: string; addrFirst: string; noSlots: string; name: string; phone: string; email: string; emailHint: string; note: string;
  street: string; houseNo: string; postalCode: string; city: string; floor: string; bell: string; hint: string; addrSearch: string; swisstopo: string;
  payment: string; payCard: string; cashPickup: string; cashDelivery: string; send: string; pay: string; allergens: string; allergenCall: string; special: string;
  required: string; remove: string; noDelivery: (plz: string) => string; minOrder: (a: string) => string; freeFrom: (a: string) => string; aborted: string;
  number: string; receipt: string; vat: string; back: string; again: string; refunded: string; status: Record<string, string>; at: (t: string) => string; deliverAt: (t: string) => string;
};

export const ORD: Record<Locale, OrdText> = {
  de: {
    title: "Online bestellen", closed: "Zurzeit keine Online-Bestellungen.", pickup: "Abholung", delivery: "Lieferung", add: "Hinzufügen", cart: "Ihre Bestellung", empty: "Noch nichts ausgewählt.",
    subtotal: "Zwischensumme", deliveryFee: "Liefergebühr", total: "Total", time: "Zeit", asap: "So bald wie möglich", addrFirst: "Zuerst die Adresse angeben, dann erscheinen die Lieferzeiten.", noSlots: "Heute sind keine Zeiten mehr frei.",
    name: "Name", phone: "Telefon", email: "E-Mail", emailHint: "Für die Bestätigung (bei Online-Zahlung Pflicht).", note: "Hinweis (optional)",
    street: "Strasse", houseNo: "Nr.", postalCode: "PLZ", city: "Ort", floor: "Stockwerk (optional)", bell: "Name an der Klingel (optional)", hint: "Hinweis für den Fahrer (optional)", addrSearch: "Adresse suchen", swisstopo: "© Daten: swisstopo",
    payment: "Bezahlung", payCard: "Online bezahlen (Karte, TWINT)", cashPickup: "Bar bei Abholung", cashDelivery: "Bar bei Lieferung", send: "Bestellung senden", pay: "Weiter zur Zahlung",
    allergens: "Allergene", allergenCall: "Fragen zu Allergenen: bitte anrufen.", special: "Sonderwunsch", required: "Pflicht", remove: "Entfernen",
    noDelivery: (p) => `Wir liefern leider nicht nach ${p}.`, minOrder: (a) => `Mindestbestellwert ${a}`, freeFrom: (a) => `gratis ab ${a}`, aborted: "Die Zahlung wurde abgebrochen. Ihre Auswahl ist noch da.",
    number: "Bestellnummer", receipt: "Quittung", vat: "MWST", back: "Zur Website", again: "Neue Bestellung", refunded: "Der bezahlte Betrag wird zurückerstattet.",
    status: { pending_payment: "Wir warten auf die Bestätigung Ihrer Zahlung.", new: "Bestellung eingegangen. Das Restaurant bestätigt gleich.", accepted: "Bestätigt.", ready: "Bereit zur Abholung.", out: "Unterwegs zu Ihnen.", completed: "Erledigt. En Guete!", rejected: "Leider abgelehnt.", expired: "Das Restaurant hat nicht rechtzeitig bestätigt; die Bestellung ist storniert.", cancelled: "Storniert.", not_accepted: "Nicht zugestellt." },
    at: (t) => `Abholbereit um ${t}`, deliverAt: (t) => `Lieferung um ca. ${t}`,
  },
  en: {
    title: "Order online", closed: "Online orders are not available right now.", pickup: "Pickup", delivery: "Delivery", add: "Add", cart: "Your order", empty: "Nothing selected yet.",
    subtotal: "Subtotal", deliveryFee: "Delivery fee", total: "Total", time: "Time", asap: "As soon as possible", addrFirst: "Enter the address first to see delivery times.", noSlots: "No more times available today.",
    name: "Name", phone: "Phone", email: "Email", emailHint: "For the confirmation (required for online payment).", note: "Note (optional)",
    street: "Street", houseNo: "No.", postalCode: "Postcode", city: "Town", floor: "Floor (optional)", bell: "Name on the bell (optional)", hint: "Note for the driver (optional)", addrSearch: "Search address", swisstopo: "© Data: swisstopo",
    payment: "Payment", payCard: "Pay online (card, TWINT)", cashPickup: "Cash on pickup", cashDelivery: "Cash on delivery", send: "Send order", pay: "Continue to payment",
    allergens: "Allergens", allergenCall: "Questions about allergens: please call us.", special: "Special request", required: "required", remove: "Remove",
    noDelivery: (p) => `Sorry, we do not deliver to ${p}.`, minOrder: (a) => `Minimum order ${a}`, freeFrom: (a) => `free from ${a}`, aborted: "The payment was cancelled. Your selection is still here.",
    number: "Order number", receipt: "Receipt", vat: "VAT", back: "To the website", again: "New order", refunded: "The amount paid will be refunded.",
    status: { pending_payment: "We are waiting for your payment to be confirmed.", new: "Order received. The restaurant will confirm shortly.", accepted: "Confirmed.", ready: "Ready for pickup.", out: "On its way to you.", completed: "Done. Enjoy your meal!", rejected: "Sorry, declined.", expired: "The restaurant did not confirm in time; the order is cancelled.", cancelled: "Cancelled.", not_accepted: "Not delivered." },
    at: (t) => `Ready at ${t}`, deliverAt: (t) => `Delivery at about ${t}`,
  },
  fr: {
    title: "Commander en ligne", closed: "Pas de commandes en ligne pour le moment.", pickup: "À emporter", delivery: "Livraison", add: "Ajouter", cart: "Votre commande", empty: "Rien de sélectionné.",
    subtotal: "Sous-total", deliveryFee: "Frais de livraison", total: "Total", time: "Heure", asap: "Dès que possible", addrFirst: "Indiquez d'abord l'adresse pour voir les heures de livraison.", noSlots: "Plus d'heures libres aujourd'hui.",
    name: "Nom", phone: "Téléphone", email: "E-mail", emailHint: "Pour la confirmation (obligatoire pour le paiement en ligne).", note: "Remarque (facultatif)",
    street: "Rue", houseNo: "N°", postalCode: "NPA", city: "Localité", floor: "Étage (facultatif)", bell: "Nom sur la sonnette (facultatif)", hint: "Remarque pour le livreur (facultatif)", addrSearch: "Chercher l'adresse", swisstopo: "© Données : swisstopo",
    payment: "Paiement", payCard: "Payer en ligne (carte, TWINT)", cashPickup: "En espèces au retrait", cashDelivery: "En espèces à la livraison", send: "Envoyer la commande", pay: "Continuer vers le paiement",
    allergens: "Allergènes", allergenCall: "Questions sur les allergènes : appelez-nous.", special: "Demande particulière", required: "obligatoire", remove: "Retirer",
    noDelivery: (p) => `Désolés, nous ne livrons pas à ${p}.`, minOrder: (a) => `Commande minimale ${a}`, freeFrom: (a) => `gratuit dès ${a}`, aborted: "Le paiement a été interrompu. Votre sélection est conservée.",
    number: "Numéro de commande", receipt: "Quittance", vat: "TVA", back: "Vers le site", again: "Nouvelle commande", refunded: "Le montant payé vous sera remboursé.",
    status: { pending_payment: "Nous attendons la confirmation de votre paiement.", new: "Commande reçue. Le restaurant confirme dans un instant.", accepted: "Confirmée.", ready: "Prête à emporter.", out: "En route vers vous.", completed: "Terminé. Bon appétit !", rejected: "Malheureusement refusée.", expired: "Le restaurant n'a pas confirmé à temps ; la commande est annulée.", cancelled: "Annulée.", not_accepted: "Non livrée." },
    at: (t) => `Prête à ${t}`, deliverAt: (t) => `Livraison vers ${t}`,
  },
  it: {
    title: "Ordina online", closed: "Al momento non si accettano ordini online.", pickup: "Ritiro", delivery: "Consegna", add: "Aggiungi", cart: "Il vostro ordine", empty: "Ancora niente selezionato.",
    subtotal: "Subtotale", deliveryFee: "Spese di consegna", total: "Totale", time: "Orario", asap: "Il prima possibile", addrFirst: "Indicate prima l'indirizzo per vedere gli orari di consegna.", noSlots: "Oggi non ci sono più orari liberi.",
    name: "Nome", phone: "Telefono", email: "E-mail", emailHint: "Per la conferma (obbligatoria per il pagamento online).", note: "Nota (facoltativa)",
    street: "Via", houseNo: "N.", postalCode: "NPA", city: "Località", floor: "Piano (facoltativo)", bell: "Nome sul campanello (facoltativo)", hint: "Nota per il fattorino (facoltativa)", addrSearch: "Cerca indirizzo", swisstopo: "© Dati: swisstopo",
    payment: "Pagamento", payCard: "Paga online (carta, TWINT)", cashPickup: "Contanti al ritiro", cashDelivery: "Contanti alla consegna", send: "Invia l'ordine", pay: "Continua al pagamento",
    allergens: "Allergeni", allergenCall: "Domande sugli allergeni: chiamateci.", special: "Richiesta speciale", required: "obbligatorio", remove: "Rimuovi",
    noDelivery: (p) => `Purtroppo non consegniamo a ${p}.`, minOrder: (a) => `Ordine minimo ${a}`, freeFrom: (a) => `gratis da ${a}`, aborted: "Il pagamento è stato interrotto. La vostra scelta è ancora qui.",
    number: "Numero d'ordine", receipt: "Ricevuta", vat: "IVA", back: "Al sito", again: "Nuovo ordine", refunded: "L'importo pagato vi sarà rimborsato.",
    status: { pending_payment: "Attendiamo la conferma del pagamento.", new: "Ordine ricevuto. Il ristorante conferma a breve.", accepted: "Confermato.", ready: "Pronto per il ritiro.", out: "In arrivo.", completed: "Fatto. Buon appetito!", rejected: "Purtroppo rifiutato.", expired: "Il ristorante non ha confermato in tempo; l'ordine è annullato.", cancelled: "Annullato.", not_accepted: "Non consegnato." },
    at: (t) => `Pronto alle ${t}`, deliverAt: (t) => `Consegna verso le ${t}`,
  },
  nl: {
    title: "Online bestellen", closed: "Op dit moment geen online bestellingen.", pickup: "Afhalen", delivery: "Bezorging", add: "Toevoegen", cart: "Uw bestelling", empty: "Nog niets gekozen.",
    subtotal: "Subtotaal", deliveryFee: "Bezorgkosten", total: "Totaal", time: "Tijd", asap: "Zo snel mogelijk", addrFirst: "Vul eerst het adres in om de bezorgtijden te zien.", noSlots: "Vandaag zijn geen tijden meer vrij.",
    name: "Naam", phone: "Telefoon", email: "E-mail", emailHint: "Voor de bevestiging (verplicht bij online betalen).", note: "Opmerking (optioneel)",
    street: "Straat", houseNo: "Nr.", postalCode: "Postcode", city: "Plaats", floor: "Verdieping (optioneel)", bell: "Naam op de bel (optioneel)", hint: "Opmerking voor de bezorger (optioneel)", addrSearch: "Adres zoeken", swisstopo: "© Gegevens: swisstopo",
    payment: "Betaling", payCard: "Online betalen (kaart, TWINT)", cashPickup: "Contant bij afhalen", cashDelivery: "Contant bij bezorging", send: "Bestelling versturen", pay: "Verder naar betalen",
    allergens: "Allergenen", allergenCall: "Vragen over allergenen: bel ons.", special: "Speciale wens", required: "verplicht", remove: "Verwijderen",
    noDelivery: (p) => `Helaas bezorgen we niet in ${p}.`, minOrder: (a) => `Minimale bestelling ${a}`, freeFrom: (a) => `gratis vanaf ${a}`, aborted: "De betaling is afgebroken. Uw keuze staat er nog.",
    number: "Bestelnummer", receipt: "Kassabon", vat: "btw", back: "Naar de website", again: "Nieuwe bestelling", refunded: "Het betaalde bedrag wordt terugbetaald.",
    status: { pending_payment: "We wachten op de bevestiging van uw betaling.", new: "Bestelling ontvangen. Het restaurant bevestigt zo.", accepted: "Bevestigd.", ready: "Klaar om af te halen.", out: "Onderweg naar u.", completed: "Klaar. Eet smakelijk!", rejected: "Helaas geweigerd.", expired: "Het restaurant heeft niet op tijd bevestigd; de bestelling is geannuleerd.", cancelled: "Geannuleerd.", not_accepted: "Niet bezorgd." },
    at: (t) => `Klaar om ${t}`, deliverAt: (t) => `Bezorging rond ${t}`,
  },
};
