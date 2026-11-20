import type { Locale } from "./dict";

/** Texte der Direktbuchungs-Werkzeuge (SPEC 19.29): Buchungsfenster, Warteliste und E-Mails an Gäste, in allen Website-Sprachen */
export type DirectMsg = {
  benefitsTitle: string;
  codeHave: string; codeLabel: string; codeHint: string;
  codeApplied: (company: string, pct: string) => string; codeAppliedInvoice: (company: string, pct: string) => string; codeInvalid: string;
  gapBadge: (pct: string) => string; gapBadgeNoDiscount: string;
  discount: string; payInvoice: string; invoiceNote: string; invoiceFail: string;
  waitTitle: string; waitText: string; waitName: string; waitEmail: string; waitButton: string; waitDone: string; waitError: string; waitNote: string;
  waitCancelled: string; waitCancelledNote: string;
  mailBenefits: string; mailDiscount: string;
  recoverySubject: (h: string) => string; recoveryText: string; recoveryText2: string; recoveryButton: string;
  waitMailSubject: (h: string) => string; waitMailText: (dates: string) => string; waitMailButton: string; waitMailNote: string; waitMailCancel: string;
};

export const D: Record<Locale, DirectMsg> = {
  de: {
    benefitsTitle: "Nur bei Direktbuchung",
    codeHave: "Firmen- oder Aktionscode", codeLabel: "Code", codeHint: "Mit einem gültigen Code gilt Ihr Firmenpreis.",
    codeApplied: (c, p) => `Code von ${c} angewendet${p ? `: −${p} %` : ""}.`, codeAppliedInvoice: (c, p) => `Code von ${c} angewendet${p ? `: −${p} %` : ""}. Die Rechnung geht an die Firma, Sie bezahlen jetzt nichts.`, codeInvalid: "Dieser Code ist ungültig oder abgelaufen.",
    gapBadge: (p) => `Lückenangebot: −${p} %`, gapBadgeNoDiscount: "Kurzaufenthalt in einer Lücke möglich",
    discount: "Rabatt", payInvoice: "Auf Rechnung buchen", invoiceNote: "Die Rechnung geht an Ihre Firma.", invoiceFail: "Die Buchung auf Rechnung ist mit diesem Code nicht möglich.",
    waitTitle: "Leider ausgebucht", waitText: "Wir benachrichtigen Sie, sobald für diese Daten etwas frei wird.", waitName: "Name", waitEmail: "E-Mail", waitButton: "Benachrichtigen Sie mich", waitDone: "Sie stehen auf der Warteliste. Wir schreiben Ihnen, sobald etwas frei ist.", waitError: "Das hat nicht geklappt. Bitte versuchen Sie es später nochmals.", waitNote: "Wir senden Ihnen dazu einmalig eine E-Mail. Ihre Adresse wird danach nicht weiter verwendet.",
    waitCancelled: "Sie sind von der Warteliste abgemeldet.", waitCancelledNote: "Sie erhalten dazu keine weiteren E-Mails.",
    mailBenefits: "Ihre Vorteile bei Direktbuchung", mailDiscount: "Rabatt",
    recoverySubject: (h) => `Ihre Reservierung bei ${h} wartet auf Sie`, recoveryText: "Sie haben vor Kurzem ein Zimmer reserviert, die Buchung aber nicht abgeschlossen. Das Zimmer ist für Ihre Daten noch frei.", recoveryText2: "Mit einem Klick kommen Sie zurück zu Ihrer Suche. Wir senden Ihnen dazu keine weitere Erinnerung.", recoveryButton: "Buchung abschliessen",
    waitMailSubject: (h) => `Jetzt frei: Ihre Wunschdaten bei ${h}`, waitMailText: (d) => `für Ihre Wunschdaten (${d}) ist jetzt wieder etwas frei. Wer zuerst bucht, bekommt das Zimmer.`, waitMailButton: "Jetzt ansehen und buchen", waitMailNote: "Dies ist die einzige Mail zu Ihrem Wunsch.", waitMailCancel: "Von der Warteliste abmelden",
  },
  en: {
    benefitsTitle: "Only when booking direct",
    codeHave: "Company or promo code", codeLabel: "Code", codeHint: "A valid code gives you the company rate.",
    codeApplied: (c, p) => `Code from ${c} applied${p ? `: −${p}%` : ""}.`, codeAppliedInvoice: (c, p) => `Code from ${c} applied${p ? `: −${p}%` : ""}. The invoice goes to the company, you pay nothing now.`, codeInvalid: "This code is invalid or has expired.",
    gapBadge: (p) => `Gap offer: −${p}%`, gapBadgeNoDiscount: "Short stay possible in a gap",
    discount: "Discount", payInvoice: "Book on invoice", invoiceNote: "The invoice goes to your company.", invoiceFail: "Booking on invoice is not possible with this code.",
    waitTitle: "Sorry, fully booked", waitText: "We will let you know as soon as something becomes free for these dates.", waitName: "Name", waitEmail: "Email", waitButton: "Notify me", waitDone: "You are on the waiting list. We will write to you as soon as something is free.", waitError: "That did not work. Please try again later.", waitNote: "We will send you one email about this. Your address is not used for anything else afterwards.",
    waitCancelled: "You have been removed from the waiting list.", waitCancelledNote: "You will not receive any further emails about this.",
    mailBenefits: "Your benefits for booking direct", mailDiscount: "Discount",
    recoverySubject: (h) => `Your reservation at ${h} is waiting for you`, recoveryText: "You recently reserved a room but did not complete the booking. The room is still available for your dates.", recoveryText2: "One click takes you back to your search. We will not send another reminder.", recoveryButton: "Complete booking",
    waitMailSubject: (h) => `Now available: your dates at ${h}`, waitMailText: (d) => `something is available again for your dates (${d}). The first to book gets the room.`, waitMailButton: "View and book now", waitMailNote: "This is the only email about your request.", waitMailCancel: "Remove me from the waiting list",
  },
  fr: {
    benefitsTitle: "Uniquement en réservation directe",
    codeHave: "Code entreprise ou promotionnel", codeLabel: "Code", codeHint: "Avec un code valable, le tarif entreprise s'applique.",
    codeApplied: (c, p) => `Code de ${c} appliqué${p ? ` : −${p} %` : ""}.`, codeAppliedInvoice: (c, p) => `Code de ${c} appliqué${p ? ` : −${p} %` : ""}. La facture est envoyée à l'entreprise, vous ne payez rien maintenant.`, codeInvalid: "Ce code n'est pas valable ou a expiré.",
    gapBadge: (p) => `Offre « trou » : −${p} %`, gapBadgeNoDiscount: "Court séjour possible dans un trou du calendrier",
    discount: "Rabais", payInvoice: "Réserver sur facture", invoiceNote: "La facture est envoyée à votre entreprise.", invoiceFail: "La réservation sur facture n'est pas possible avec ce code.",
    waitTitle: "Complet, malheureusement", waitText: "Nous vous préviendrons dès que quelque chose se libère pour ces dates.", waitName: "Nom", waitEmail: "E-mail", waitButton: "Prévenez-moi", waitDone: "Vous êtes sur la liste d'attente. Nous vous écrirons dès que quelque chose se libère.", waitError: "Cela n'a pas fonctionné. Veuillez réessayer plus tard.", waitNote: "Nous vous enverrons un seul e-mail à ce sujet. Votre adresse ne sera pas utilisée autrement.",
    waitCancelled: "Vous êtes retiré de la liste d'attente.", waitCancelledNote: "Vous ne recevrez plus d'e-mails à ce sujet.",
    mailBenefits: "Vos avantages en réservation directe", mailDiscount: "Rabais",
    recoverySubject: (h) => `Votre réservation chez ${h} vous attend`, recoveryText: "Vous avez récemment réservé une chambre sans terminer la réservation. La chambre est encore libre pour vos dates.", recoveryText2: "Un clic vous ramène à votre recherche. Nous ne vous enverrons pas d'autre rappel.", recoveryButton: "Terminer la réservation",
    waitMailSubject: (h) => `Disponible maintenant : vos dates chez ${h}`, waitMailText: (d) => `quelque chose est de nouveau disponible pour vos dates (${d}). Le premier à réserver obtient la chambre.`, waitMailButton: "Voir et réserver maintenant", waitMailNote: "C'est le seul e-mail concernant votre demande.", waitMailCancel: "Me retirer de la liste d'attente",
  },
  it: {
    benefitsTitle: "Solo con prenotazione diretta",
    codeHave: "Codice aziendale o promozionale", codeLabel: "Codice", codeHint: "Con un codice valido si applica la tariffa aziendale.",
    codeApplied: (c, p) => `Codice di ${c} applicato${p ? `: −${p} %` : ""}.`, codeAppliedInvoice: (c, p) => `Codice di ${c} applicato${p ? `: −${p} %` : ""}. La fattura viene inviata all'azienda, ora non pagate nulla.`, codeInvalid: "Questo codice non è valido o è scaduto.",
    gapBadge: (p) => `Offerta «buco»: −${p} %`, gapBadgeNoDiscount: "Soggiorno breve possibile in un buco del calendario",
    discount: "Sconto", payInvoice: "Prenota su fattura", invoiceNote: "La fattura viene inviata alla vostra azienda.", invoiceFail: "La prenotazione su fattura non è possibile con questo codice.",
    waitTitle: "Purtroppo al completo", waitText: "Vi avviseremo non appena si libera qualcosa per queste date.", waitName: "Nome", waitEmail: "E-mail", waitButton: "Avvisatemi", waitDone: "Siete in lista d'attesa. Vi scriveremo non appena si libera qualcosa.", waitError: "Non ha funzionato. Riprovate più tardi.", waitNote: "Vi invieremo una sola e-mail in merito. Il vostro indirizzo non verrà più utilizzato.",
    waitCancelled: "Siete stati cancellati dalla lista d'attesa.", waitCancelledNote: "Non riceverete altre e-mail in merito.",
    mailBenefits: "I vostri vantaggi con la prenotazione diretta", mailDiscount: "Sconto",
    recoverySubject: (h) => `La vostra prenotazione presso ${h} vi aspetta`, recoveryText: "Avete prenotato di recente una camera senza concludere la prenotazione. La camera è ancora libera per le vostre date.", recoveryText2: "Con un clic tornate alla vostra ricerca. Non invieremo altri promemoria.", recoveryButton: "Concludi la prenotazione",
    waitMailSubject: (h) => `Ora disponibile: le vostre date presso ${h}`, waitMailText: (d) => `per le vostre date (${d}) c'è di nuovo qualcosa di libero. Chi prenota per primo ottiene la camera.`, waitMailButton: "Vedi e prenota ora", waitMailNote: "Questa è l'unica e-mail relativa alla vostra richiesta.", waitMailCancel: "Cancellami dalla lista d'attesa",
  },
  nl: {
    benefitsTitle: "Alleen bij directe boeking",
    codeHave: "Bedrijfs- of actiecode", codeLabel: "Code", codeHint: "Met een geldige code geldt uw bedrijfstarief.",
    codeApplied: (c, p) => `Code van ${c} toegepast${p ? `: −${p}%` : ""}.`, codeAppliedInvoice: (c, p) => `Code van ${c} toegepast${p ? `: −${p}%` : ""}. De factuur gaat naar het bedrijf, u betaalt nu niets.`, codeInvalid: "Deze code is ongeldig of verlopen.",
    gapBadge: (p) => `Gat-aanbieding: −${p}%`, gapBadgeNoDiscount: "Kort verblijf mogelijk in een gat in de agenda",
    discount: "Korting", payInvoice: "Boeken op factuur", invoiceNote: "De factuur gaat naar uw bedrijf.", invoiceFail: "Boeken op factuur is met deze code niet mogelijk.",
    waitTitle: "Helaas volgeboekt", waitText: "We laten het u weten zodra er voor deze data iets vrijkomt.", waitName: "Naam", waitEmail: "E-mail", waitButton: "Houd mij op de hoogte", waitDone: "U staat op de wachtlijst. We schrijven u zodra er iets vrij is.", waitError: "Dat is niet gelukt. Probeer het later opnieuw.", waitNote: "We sturen u hierover één e-mail. Uw adres wordt daarna nergens anders voor gebruikt.",
    waitCancelled: "U bent van de wachtlijst afgemeld.", waitCancelledNote: "U ontvangt hierover geen e-mails meer.",
    mailBenefits: "Uw voordelen bij directe boeking", mailDiscount: "Korting",
    recoverySubject: (h) => `Uw reservering bij ${h} wacht op u`, recoveryText: "U hebt onlangs een kamer gereserveerd maar de boeking niet afgerond. De kamer is voor uw data nog vrij.", recoveryText2: "Met één klik gaat u terug naar uw zoekopdracht. We sturen geen verdere herinnering.", recoveryButton: "Boeking afronden",
    waitMailSubject: (h) => `Nu beschikbaar: uw data bij ${h}`, waitMailText: (d) => `voor uw data (${d}) is er weer iets vrij. Wie het eerst boekt, krijgt de kamer.`, waitMailButton: "Nu bekijken en boeken", waitMailNote: "Dit is de enige e-mail over uw verzoek.", waitMailCancel: "Afmelden van de wachtlijst",
  },
};
