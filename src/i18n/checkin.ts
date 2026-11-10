import type { Locale } from "./dict";

/** Texte Online-Check-in / Meldeschein (SPEC 14). FR/IT/NL: Muttersprachler-Prüfung offen (QUESTIONS.md). */
export type CheckinText = {
  title: string; intro: (hotel: string) => string; groupIntro: string;
  person: (n: number) => string; participants: string; participantsHint: string;
  firstName: string; lastName: string; sex: string; sexF: string; sexM: string; sexX: string; birthDate: string; nationality: string;
  street: string; postalCode: string; city: string; country: string; sameAddress: string;
  docType: string; passport: string; idCard: string; residencePermit: string; otherDoc: string; docNumber: string; docMinorHint: string;
  vehicle: string; optional: string; choose: string;
  signature: string; signHint: string; clear: string;
  confirm: string; submit: string; sending: string;
  thanks: string; thanksText: string; correct: string; verified: string;
  privacy: (years: number) => string;
  errInvalid: string; errSignature: string; errConfirm: string; errLocked: string; errGeneric: string;
  linkTitle: string; linkText: string; linkDone: string; linkButton: string;
  addRow: string; removeRow: string;
};

export const CI: Record<Locale, CheckinText> = {
  de: {
    title: "Online-Check-in", intro: (h) => `Das Gesetz verlangt, dass ${h} von allen Gästen einen Meldeschein führt. Füllen Sie ihn jetzt aus, dann geht es bei der Ankunft schneller. Bitte halten Sie Ihren Ausweis bereit, das Personal wirft beim Empfang kurz einen Blick darauf.`,
    groupIntro: "Für Gruppen genügt der vollständige Meldeschein der Kontaktperson und eine Teilnehmerliste.",
    person: (n) => (n === 1 ? "Person 1 (Kontaktperson)" : `Person ${n}`), participants: "Teilnehmerliste", participantsHint: "Name, Geburtsdatum und Nationalität aller weiteren Teilnehmenden.",
    firstName: "Vorname", lastName: "Nachname", sex: "Geschlecht", sexF: "weiblich", sexM: "männlich", sexX: "divers", birthDate: "Geburtsdatum", nationality: "Nationalität",
    street: "Strasse und Nr.", postalCode: "PLZ", city: "Ort", country: "Land", sameAddress: "gleiche Adresse wie Person 1",
    docType: "Ausweis", passport: "Pass", idCard: "Identitätskarte", residencePermit: "Ausländerausweis", otherDoc: "anderer amtlicher Ausweis", docNumber: "Ausweisnummer", docMinorHint: "bei Kindern ohne eigenen Ausweis leer lassen",
    vehicle: "Autokennzeichen", optional: "freiwillig", choose: "Bitte wählen",
    signature: "Unterschrift", signHint: "Mit Finger oder Maus im Feld unterschreiben.", clear: "Löschen",
    confirm: "Ich bestätige, dass die Angaben vollständig und richtig sind.", submit: "Meldeschein absenden", sending: "Wird gesendet …",
    thanks: "Vielen Dank!", thanksText: "Ihr Meldeschein ist bei uns. Bei der Ankunft zeigen Sie nur noch kurz Ihren Ausweis.", correct: "Angaben korrigieren", verified: "Der Check-in ist abgeschlossen.",
    privacy: (y) => `Die Angaben werden nach kantonalem Recht geführt, nur der Polizei auf Verlangen herausgegeben und ${y} Jahre nach der Abreise gelöscht. Geburtsdatum, Ausweisnummer und Unterschrift speichern wir verschlüsselt.`,
    errInvalid: "Bitte die markierten Felder prüfen.", errSignature: "Bitte unterschreiben.", errConfirm: "Bitte die Richtigkeit bestätigen.", errLocked: "Der Check-in wurde bereits am Empfang abgeschlossen. Änderungen bitte direkt beim Hotel.", errGeneric: "Das hat leider nicht geklappt. Bitte später nochmals versuchen.",
    linkTitle: "Online-Check-in", linkText: "Füllen Sie den Meldeschein schon jetzt aus, dann geht es bei der Ankunft schneller.", linkDone: "Meldeschein ist ausgefüllt.", linkButton: "Zum Online-Check-in",
    addRow: "Person hinzufügen", removeRow: "Entfernen",
  },
  en: {
    title: "Online check-in", intro: (h) => `By law, ${h} must keep a registration form for every guest. Fill it in now to save time on arrival. Please have your ID ready, staff will take a quick look at reception.`,
    groupIntro: "For groups, the full form of the contact person plus a list of participants is sufficient.",
    person: (n) => (n === 1 ? "Person 1 (contact person)" : `Person ${n}`), participants: "List of participants", participantsHint: "Name, date of birth and nationality of all other participants.",
    firstName: "First name", lastName: "Last name", sex: "Gender", sexF: "female", sexM: "male", sexX: "diverse", birthDate: "Date of birth", nationality: "Nationality",
    street: "Street and no.", postalCode: "Postcode", city: "City", country: "Country", sameAddress: "same address as person 1",
    docType: "ID document", passport: "Passport", idCard: "Identity card", residencePermit: "Residence permit", otherDoc: "other official ID", docNumber: "Document number", docMinorHint: "leave empty for children without their own ID",
    vehicle: "Licence plate", optional: "optional", choose: "Please choose",
    signature: "Signature", signHint: "Sign in the box with your finger or mouse.", clear: "Clear",
    confirm: "I confirm that the information is complete and correct.", submit: "Submit registration", sending: "Sending …",
    thanks: "Thank you!", thanksText: "We have received your registration. On arrival, just show your ID briefly.", correct: "Correct details", verified: "Check-in is complete.",
    privacy: (y) => `The data is kept as required by cantonal law, disclosed only to the police on request and deleted ${y} years after departure. Date of birth, document number and signature are stored encrypted.`,
    errInvalid: "Please check the highlighted fields.", errSignature: "Please sign.", errConfirm: "Please confirm that the information is correct.", errLocked: "Check-in has already been completed at reception. Please contact the hotel for changes.", errGeneric: "Something went wrong. Please try again later.",
    linkTitle: "Online check-in", linkText: "Fill in the registration form now to save time on arrival.", linkDone: "Registration form completed.", linkButton: "Go to online check-in",
    addRow: "Add person", removeRow: "Remove",
  },
  fr: {
    title: "Enregistrement en ligne", intro: (h) => `La loi oblige ${h} à tenir une fiche d'hôtel pour chaque client. Remplissez-la maintenant pour gagner du temps à l'arrivée. Merci d'avoir votre pièce d'identité à portée de main, le personnel y jettera un coup d'œil à la réception.`,
    groupIntro: "Pour les groupes, la fiche complète de la personne de contact et une liste des participants suffisent.",
    person: (n) => (n === 1 ? "Personne 1 (contact)" : `Personne ${n}`), participants: "Liste des participants", participantsHint: "Nom, date de naissance et nationalité de tous les autres participants.",
    firstName: "Prénom", lastName: "Nom", sex: "Sexe", sexF: "féminin", sexM: "masculin", sexX: "divers", birthDate: "Date de naissance", nationality: "Nationalité",
    street: "Rue et n°", postalCode: "NPA", city: "Localité", country: "Pays", sameAddress: "même adresse que la personne 1",
    docType: "Pièce d'identité", passport: "Passeport", idCard: "Carte d'identité", residencePermit: "Permis de séjour", otherDoc: "autre pièce officielle", docNumber: "Numéro du document", docMinorHint: "laisser vide pour les enfants sans pièce propre",
    vehicle: "Plaque d'immatriculation", optional: "facultatif", choose: "Veuillez choisir",
    signature: "Signature", signHint: "Signez dans le cadre avec le doigt ou la souris.", clear: "Effacer",
    confirm: "Je confirme que les informations sont complètes et exactes.", submit: "Envoyer la fiche", sending: "Envoi …",
    thanks: "Merci beaucoup !", thanksText: "Nous avons bien reçu votre fiche. À l'arrivée, il suffit de montrer brièvement votre pièce d'identité.", correct: "Corriger les données", verified: "L'enregistrement est terminé.",
    privacy: (y) => `Les données sont tenues selon le droit cantonal, transmises uniquement à la police sur demande et supprimées ${y} ans après le départ. La date de naissance, le numéro du document et la signature sont enregistrés de manière chiffrée.`,
    errInvalid: "Veuillez vérifier les champs signalés.", errSignature: "Veuillez signer.", errConfirm: "Veuillez confirmer l'exactitude des données.", errLocked: "L'enregistrement a déjà été finalisé à la réception. Pour toute modification, contactez l'hôtel.", errGeneric: "Une erreur s'est produite. Veuillez réessayer plus tard.",
    linkTitle: "Enregistrement en ligne", linkText: "Remplissez dès maintenant la fiche d'hôtel pour gagner du temps à l'arrivée.", linkDone: "La fiche d'hôtel est remplie.", linkButton: "Vers l'enregistrement en ligne",
    addRow: "Ajouter une personne", removeRow: "Supprimer",
  },
  it: {
    title: "Check-in online", intro: (h) => `Per legge ${h} deve tenere una scheda di notifica per ogni ospite. Compilatela ora per risparmiare tempo all'arrivo. Tenete pronto un documento d'identità, il personale lo controllerà brevemente alla reception.`,
    groupIntro: "Per i gruppi basta la scheda completa della persona di contatto e una lista dei partecipanti.",
    person: (n) => (n === 1 ? "Persona 1 (contatto)" : `Persona ${n}`), participants: "Lista dei partecipanti", participantsHint: "Nome, data di nascita e nazionalità di tutti gli altri partecipanti.",
    firstName: "Nome", lastName: "Cognome", sex: "Sesso", sexF: "femminile", sexM: "maschile", sexX: "diverso", birthDate: "Data di nascita", nationality: "Nazionalità",
    street: "Via e n.", postalCode: "NPA", city: "Località", country: "Paese", sameAddress: "stesso indirizzo della persona 1",
    docType: "Documento d'identità", passport: "Passaporto", idCard: "Carta d'identità", residencePermit: "Permesso di soggiorno", otherDoc: "altro documento ufficiale", docNumber: "Numero del documento", docMinorHint: "lasciare vuoto per i bambini senza documento proprio",
    vehicle: "Targa", optional: "facoltativo", choose: "Scegliere",
    signature: "Firma", signHint: "Firmate nel riquadro con il dito o il mouse.", clear: "Cancella",
    confirm: "Confermo che i dati sono completi e corretti.", submit: "Invia la scheda", sending: "Invio …",
    thanks: "Grazie mille!", thanksText: "Abbiamo ricevuto la vostra scheda. All'arrivo basta mostrare brevemente il documento d'identità.", correct: "Correggere i dati", verified: "Il check-in è concluso.",
    privacy: (y) => `I dati sono tenuti secondo il diritto cantonale, consegnati solo alla polizia su richiesta e cancellati ${y} anni dopo la partenza. Data di nascita, numero del documento e firma sono salvati in forma cifrata.`,
    errInvalid: "Verificate i campi evidenziati.", errSignature: "Si prega di firmare.", errConfirm: "Confermate che i dati sono corretti.", errLocked: "Il check-in è già stato concluso alla reception. Per modifiche rivolgetevi all'hotel.", errGeneric: "Qualcosa non ha funzionato. Riprovate più tardi.",
    linkTitle: "Check-in online", linkText: "Compilate già ora la scheda di notifica per risparmiare tempo all'arrivo.", linkDone: "La scheda di notifica è compilata.", linkButton: "Al check-in online",
    addRow: "Aggiungi persona", removeRow: "Rimuovi",
  },
  nl: {
    title: "Online inchecken", intro: (h) => `${h} is wettelijk verplicht van elke gast een meldformulier bij te houden. Vul het nu in, dan gaat het bij aankomst sneller. Houd uw identiteitsbewijs bij de hand, het personeel kijkt er bij de receptie even naar.`,
    groupIntro: "Voor groepen volstaat het volledige formulier van de contactpersoon plus een deelnemerslijst.",
    person: (n) => (n === 1 ? "Persoon 1 (contactpersoon)" : `Persoon ${n}`), participants: "Deelnemerslijst", participantsHint: "Naam, geboortedatum en nationaliteit van alle overige deelnemers.",
    firstName: "Voornaam", lastName: "Achternaam", sex: "Geslacht", sexF: "vrouw", sexM: "man", sexX: "divers", birthDate: "Geboortedatum", nationality: "Nationaliteit",
    street: "Straat en nr.", postalCode: "Postcode", city: "Plaats", country: "Land", sameAddress: "zelfde adres als persoon 1",
    docType: "Identiteitsbewijs", passport: "Paspoort", idCard: "Identiteitskaart", residencePermit: "Verblijfsvergunning", otherDoc: "ander officieel document", docNumber: "Documentnummer", docMinorHint: "leeg laten voor kinderen zonder eigen document",
    vehicle: "Kenteken", optional: "optioneel", choose: "Kies a.u.b.",
    signature: "Handtekening", signHint: "Teken in het vak met uw vinger of muis.", clear: "Wissen",
    confirm: "Ik bevestig dat de gegevens volledig en juist zijn.", submit: "Formulier versturen", sending: "Bezig met versturen …",
    thanks: "Hartelijk dank!", thanksText: "We hebben uw meldformulier ontvangen. Bij aankomst toont u alleen nog even uw identiteitsbewijs.", correct: "Gegevens corrigeren", verified: "Het inchecken is afgerond.",
    privacy: (y) => `De gegevens worden volgens kantonaal recht bijgehouden, alleen op verzoek aan de politie verstrekt en ${y} jaar na vertrek verwijderd. Geboortedatum, documentnummer en handtekening worden versleuteld opgeslagen.`,
    errInvalid: "Controleer de gemarkeerde velden.", errSignature: "Gelieve te tekenen.", errConfirm: "Bevestig dat de gegevens juist zijn.", errLocked: "Het inchecken is al afgerond bij de receptie. Neem voor wijzigingen contact op met het hotel.", errGeneric: "Er ging iets mis. Probeer het later opnieuw.",
    linkTitle: "Online inchecken", linkText: "Vul het meldformulier nu al in, dan gaat het bij aankomst sneller.", linkDone: "Meldformulier is ingevuld.", linkButton: "Naar online inchecken",
    addRow: "Persoon toevoegen", removeRow: "Verwijderen",
  },
};
