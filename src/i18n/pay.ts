import type { Locale } from "./dict";

/** Texte des Payment Element (SPEC 19.52): Zahlungsformular, Fehler, «Zahlung fortsetzen» */
export type PayText = {
  pay: string; paying: string; loading: string; secure: string; abort: string; retry: string;
  errGeneric: string; errNetwork: string; errExpired: string; errDeclined: string; errLoad: string; errSlow: string;
  checkStatus: string; failedReturn: string; resumeLead: string; gone: string; pending: string; rebook: string;
};

export const PAY: Record<Locale, PayText> = {
  de: {
    pay: "Jetzt bezahlen", paying: "Zahlung läuft …", loading: "Zahlungsformular wird geladen …", secure: "Sichere Zahlung über Stripe. Ihre Kartendaten sehen wir nicht.",
    abort: "Zahlung abbrechen", retry: "Erneut versuchen",
    errGeneric: "Die Zahlung hat nicht geklappt. Bitte versuchen Sie es erneut oder wählen Sie eine andere Zahlart.",
    errNetwork: "Keine Verbindung zum Zahlungsdienst. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut. Ihre Karte wurde nicht belastet.",
    errExpired: "Die Reservierung ist abgelaufen oder die Zahlung wurde beendet. Bitte buchen Sie erneut.",
    errDeclined: "Die Zahlung wurde nicht angenommen. Bitte versuchen Sie es mit einer anderen Zahlart.",
    errLoad: "Das Zahlungsformular konnte nicht geladen werden. Bitte laden Sie die Seite neu (Werbeblocker können es verhindern).",
    errSlow: "Die Antwort des Zahlungsdienstes dauert ungewöhnlich lange. Bitte klicken Sie nicht erneut auf «Bezahlen», sondern prüfen Sie den Stand. Wurde der Betrag belastet, erhalten Sie die Bestätigung per E-Mail.",
    checkStatus: "Stand prüfen", failedReturn: "Die Zahlung wurde nicht abgeschlossen. Sie können es erneut versuchen, das Zimmer bleibt kurz reserviert.",
    resumeLead: "Ihre Zahlung ist noch offen.", gone: "Die Reservierung ist abgelaufen.", pending: "Wir warten noch auf die Bestätigung der Zahlung. Diese Seite aktualisiert sich gleich.", rebook: "Neu buchen",
  },
  en: {
    pay: "Pay now", paying: "Processing payment …", loading: "Loading payment form …", secure: "Secure payment via Stripe. We never see your card details.",
    abort: "Cancel payment", retry: "Try again",
    errGeneric: "The payment did not go through. Please try again or choose another payment method.",
    errNetwork: "Could not reach the payment service. Please check your connection and try again. Your card has not been charged.",
    errExpired: "The reservation has expired or the payment was ended. Please book again.",
    errDeclined: "The payment was not accepted. Please try another payment method.",
    errLoad: "The payment form could not be loaded. Please reload the page (ad blockers can prevent it).",
    errSlow: "The payment service is taking unusually long. Please do not click «Pay» again, check the status instead. If you were charged, you will receive the confirmation by e-mail.",
    checkStatus: "Check status", failedReturn: "The payment was not completed. You can try again, the room stays reserved for a short time.",
    resumeLead: "Your payment is still open.", gone: "The reservation has expired.", pending: "We're waiting for the payment confirmation. This page will refresh shortly.", rebook: "Book again",
  },
  fr: {
    pay: "Payer maintenant", paying: "Paiement en cours …", loading: "Chargement du formulaire de paiement …", secure: "Paiement sécurisé via Stripe. Nous ne voyons pas vos données de carte.",
    abort: "Annuler le paiement", retry: "Réessayer",
    errGeneric: "Le paiement n'a pas abouti. Veuillez réessayer ou choisir un autre moyen de paiement.",
    errNetwork: "Impossible de joindre le service de paiement. Vérifiez votre connexion et réessayez. Votre carte n'a pas été débitée.",
    errExpired: "La réservation a expiré ou le paiement a été clos. Veuillez réserver à nouveau.",
    errDeclined: "Le paiement n'a pas été accepté. Veuillez essayer un autre moyen de paiement.",
    errLoad: "Le formulaire de paiement n'a pas pu être chargé. Rechargez la page (un bloqueur de publicités peut l'empêcher).",
    errSlow: "Le service de paiement met un temps inhabituel à répondre. Ne cliquez pas de nouveau sur «Payer», vérifiez plutôt l'état. Si vous avez été débité, vous recevrez la confirmation par e-mail.",
    checkStatus: "Vérifier l'état", failedReturn: "Le paiement n'a pas été finalisé. Vous pouvez réessayer, la chambre reste réservée un court instant.",
    resumeLead: "Votre paiement est encore en attente.", gone: "La réservation a expiré.", pending: "Nous attendons la confirmation du paiement. Cette page va s'actualiser.", rebook: "Réserver à nouveau",
  },
  it: {
    pay: "Paga ora", paying: "Pagamento in corso …", loading: "Caricamento del modulo di pagamento …", secure: "Pagamento sicuro tramite Stripe. Non vediamo i dati della vostra carta.",
    abort: "Annulla il pagamento", retry: "Riprovare",
    errGeneric: "Il pagamento non è andato a buon fine. Riprovate o scegliete un altro metodo di pagamento.",
    errNetwork: "Impossibile raggiungere il servizio di pagamento. Controllate la connessione e riprovate. La carta non è stata addebitata.",
    errExpired: "La prenotazione è scaduta o il pagamento è stato chiuso. Prenotate di nuovo.",
    errDeclined: "Il pagamento non è stato accettato. Provate con un altro metodo di pagamento.",
    errLoad: "Il modulo di pagamento non è stato caricato. Ricaricate la pagina (un blocco pubblicità può impedirlo).",
    errSlow: "Il servizio di pagamento impiega insolitamente a lungo. Non cliccate di nuovo su «Paga», controllate piuttosto lo stato. Se l'importo è stato addebitato, riceverete la conferma per e-mail.",
    checkStatus: "Controlla lo stato", failedReturn: "Il pagamento non è stato completato. Potete riprovare, la camera resta riservata per breve tempo.",
    resumeLead: "Il pagamento è ancora aperto.", gone: "La prenotazione è scaduta.", pending: "Attendiamo la conferma del pagamento. Questa pagina si aggiorna a breve.", rebook: "Prenota di nuovo",
  },
  nl: {
    pay: "Nu betalen", paying: "Betaling wordt verwerkt …", loading: "Betaalformulier wordt geladen …", secure: "Veilig betalen via Stripe. Wij zien uw kaartgegevens niet.",
    abort: "Betaling annuleren", retry: "Opnieuw proberen",
    errGeneric: "De betaling is niet gelukt. Probeer het opnieuw of kies een andere betaalmethode.",
    errNetwork: "De betaaldienst is niet bereikbaar. Controleer uw verbinding en probeer het opnieuw. Uw kaart is niet belast.",
    errExpired: "De reservering is verlopen of de betaling is beëindigd. Boek opnieuw.",
    errDeclined: "De betaling is niet geaccepteerd. Probeer een andere betaalmethode.",
    errLoad: "Het betaalformulier kon niet worden geladen. Laad de pagina opnieuw (een adblocker kan dit verhinderen).",
    errSlow: "De betaaldienst doet er ongewoon lang over. Klik niet opnieuw op «Betalen», maar controleer de status. Is het bedrag afgeschreven, dan ontvangt u de bevestiging per e-mail.",
    checkStatus: "Status controleren", failedReturn: "De betaling is niet afgerond. U kunt het opnieuw proberen, de kamer blijft kort gereserveerd.",
    resumeLead: "Uw betaling staat nog open.", gone: "De reservering is verlopen.", pending: "We wachten nog op de bevestiging van de betaling. Deze pagina wordt zo vernieuwd.", rebook: "Opnieuw boeken",
  },
};
