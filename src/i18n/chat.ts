import type { Locale } from "./dict";

/** Texte des KI-Chats (SPEC 14b): Hinweise, Pause, Fehler, Weiterleitung */
export type ChatText = {
  title: string; open: string; close: string; placeholder: string; send: string; hello: string; notice: string;
  paused: string; error: string; tooLong: string; forward: string; forwardName: string; forwardEmail: string; forwardSend: string; forwardDone: string; forwardFail: string; thinking: string;
};

export const CHAT_TEXT: Record<Locale, ChatText> = {
  de: {
    title: "Fragen ans Haus", open: "Fragen? Chat öffnen", close: "Schliessen", placeholder: "Ihre Frage …", send: "Senden", thinking: "Einen Moment …",
    hello: "Guten Tag! Ich bin der digitale Assistent dieses Hauses. Fragen Sie mich nach Zeiten, Zimmern, Restaurant oder Ausflugstipps.",
    notice: "KI-Assistent: Antworten können Fehler enthalten. Zimmerpreise und Verfügbarkeit finden Sie in der Suche.",
    paused: "Der Chat ist im Moment nicht verfügbar. Gerne leitet das Haus Ihre Frage direkt weiter.",
    error: "Das hat leider nicht geklappt. Bitte versuchen Sie es gleich nochmals oder schreiben Sie dem Haus.",
    tooLong: "Bitte fassen Sie Ihre Frage kürzer (höchstens 500 Zeichen).",
    forward: "Frage ans Haus weiterleiten", forwardName: "Ihr Name", forwardEmail: "Ihre E-Mail", forwardSend: "Weiterleiten",
    forwardDone: "Danke! Das Haus meldet sich bei Ihnen.", forwardFail: "Das Weiterleiten hat nicht geklappt. Bitte prüfen Sie Name und E-Mail.",
  },
  en: {
    title: "Ask the house", open: "Questions? Open chat", close: "Close", placeholder: "Your question …", send: "Send", thinking: "One moment …",
    hello: "Hello! I'm the digital assistant of this house. Ask me about opening times, rooms, the restaurant or things to do nearby.",
    notice: "AI assistant: answers may contain mistakes. Room prices and availability are in the search.",
    paused: "The chat is not available right now. We'd be happy to pass your question on to the house.",
    error: "Sorry, that did not work. Please try again in a moment or write to the house.",
    tooLong: "Please keep your question shorter (500 characters at most).",
    forward: "Send your question to the house", forwardName: "Your name", forwardEmail: "Your e-mail", forwardSend: "Send",
    forwardDone: "Thank you! The house will get back to you.", forwardFail: "Sending did not work. Please check your name and e-mail.",
  },
  fr: {
    title: "Une question ?", open: "Une question ? Ouvrir le chat", close: "Fermer", placeholder: "Votre question …", send: "Envoyer", thinking: "Un instant …",
    hello: "Bonjour ! Je suis l'assistant numérique de cet établissement. Posez-moi vos questions sur les horaires, les chambres, le restaurant ou les excursions.",
    notice: "Assistant IA : les réponses peuvent contenir des erreurs. Les prix et disponibilités des chambres se trouvent dans la recherche.",
    paused: "Le chat n'est pas disponible pour le moment. L'établissement transmettra volontiers votre question.",
    error: "Cela n'a pas fonctionné. Veuillez réessayer dans un instant ou écrire à l'établissement.",
    tooLong: "Merci de raccourcir votre question (500 caractères au maximum).",
    forward: "Transmettre la question à l'établissement", forwardName: "Votre nom", forwardEmail: "Votre e-mail", forwardSend: "Transmettre",
    forwardDone: "Merci ! L'établissement vous répondra.", forwardFail: "L'envoi a échoué. Veuillez vérifier votre nom et votre e-mail.",
  },
  it: {
    title: "Domande sulla struttura", open: "Domande? Apri la chat", close: "Chiudi", placeholder: "La sua domanda …", send: "Invia", thinking: "Un attimo …",
    hello: "Buongiorno! Sono l'assistente digitale di questa struttura. Mi chieda di orari, camere, ristorante o escursioni.",
    notice: "Assistente IA: le risposte possono contenere errori. Prezzi e disponibilità delle camere si trovano nella ricerca.",
    paused: "La chat al momento non è disponibile. La struttura inoltrerà volentieri la sua domanda.",
    error: "Non ha funzionato. Riprovi tra un istante o scriva alla struttura.",
    tooLong: "Accorci la domanda (massimo 500 caratteri).",
    forward: "Inoltra la domanda alla struttura", forwardName: "Il suo nome", forwardEmail: "La sua e-mail", forwardSend: "Inoltra",
    forwardDone: "Grazie! La struttura la contatterà.", forwardFail: "Invio non riuscito. Controlli nome ed e-mail.",
  },
  nl: {
    title: "Vragen over het huis", open: "Vragen? Open de chat", close: "Sluiten", placeholder: "Uw vraag …", send: "Verzenden", thinking: "Een moment …",
    hello: "Goedendag! Ik ben de digitale assistent van dit huis. Vraag me naar tijden, kamers, het restaurant of tips voor uitstapjes.",
    notice: "AI-assistent: antwoorden kunnen fouten bevatten. Kamerprijzen en beschikbaarheid vindt u in de zoekfunctie.",
    paused: "De chat is op dit moment niet beschikbaar. Het huis geeft uw vraag graag door.",
    error: "Dat is niet gelukt. Probeer het zo nog eens of schrijf het huis.",
    tooLong: "Houd uw vraag korter (maximaal 500 tekens).",
    forward: "Vraag doorsturen naar het huis", forwardName: "Uw naam", forwardEmail: "Uw e-mail", forwardSend: "Doorsturen",
    forwardDone: "Dank u! Het huis neemt contact met u op.", forwardFail: "Doorsturen is niet gelukt. Controleer uw naam en e-mail.",
  },
};
