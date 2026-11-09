import { formatChf } from "../domain/money";
import { cancellationPolicyText } from "../domain/cancellation";
import { formatDay, isLocale, t, type Locale } from "../i18n/dict";
import type { Booking, Hotel, RatePlan, RoomType } from "../db/schema";
import { planName, roomName } from "../domain/i18n-names";

/**
 * E-Mail-Texte (SPEC 10): an Gäste in allen Website-Sprachen, an das Hotel DE/EN.
 */
// ASSUMPTION: Einfache HTML-Templates in TypeScript statt React Email – keine zusätzliche Abhängigkeit für v1.

export type EmailContext = {
  hotel: Hotel;
  booking?: Booking | null;
  guestName?: string | null;
  roomType?: RoomType | null;
  plan?: RatePlan | null;
  data: Record<string, unknown>;
  baseUrl: string;
};

export type Rendered = { subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type GuestMsg = {
  reference: string; checkin: string; checkout: string; room: string; guests: string; children: string; total: string; inclTax: string;
  view: string; hi: (n?: string | null) => string; cancellation: string;
  confirmedSubject: (r: string) => string; confirmedText: string;
  cancelledSubject: (r: string) => string; cancelledText: (r: string, m: string) => string;
  preSubject: (h: string) => string; preText: (t: string) => string;
  postSubject: (h: string) => string; postText: string; bookAgain: string;
  refundSubject: (r: string) => string; refundText: (m: string) => string;
};

/** Texte für Gäste in allen Website-Sprachen (Hotel-interne Mails bleiben DE/EN) */
const G: Record<Locale, GuestMsg> = {
  de: {
    reference: "Buchungsnummer", checkin: "Anreise", checkout: "Abreise", room: "Zimmer", guests: "Personen", children: "Kinder", total: "Total", inclTax: "inkl. Kurtaxe",
    view: "Buchung ansehen", hi: (n) => (n ? `Guten Tag ${n}` : "Guten Tag"), cancellation: "Storno",
    confirmedSubject: (r) => `Buchungsbestätigung ${r}`, confirmedText: "vielen Dank für Ihre Direktbuchung. Wir freuen uns auf Ihren Besuch.",
    cancelledSubject: (r) => `Stornierung ${r}`, cancelledText: (r, m) => `die Buchung ${r} wurde storniert. Rückerstattung: ${m}.`,
    preSubject: (h) => `Bald ist es so weit – ${h}`, preText: (t) => `in wenigen Tagen reisen Sie an. Check-in ab ${t} Uhr.`,
    postSubject: (h) => `Danke für Ihren Besuch – ${h}`, postText: "vielen Dank für Ihren Aufenthalt. Beim nächsten Mal direkt buchen und den besten Preis sichern.", bookAgain: "Wieder buchen",
    refundSubject: (r) => `Zahlung erstattet ${r}`, refundText: (m) => `Ihre Zahlung ist nach Ablauf der Reservierung eingegangen und das Zimmer war nicht mehr frei. Wir haben ${m} vollständig zurückerstattet.`,
  },
  en: {
    reference: "Booking number", checkin: "Check-in", checkout: "Check-out", room: "Room", guests: "Guests", children: "children", total: "Total", inclTax: "incl. tourist tax",
    view: "View booking", hi: (n) => (n ? `Dear ${n}` : "Hello"), cancellation: "Cancellation",
    confirmedSubject: (r) => `Booking confirmation ${r}`, confirmedText: "thank you for booking direct. We look forward to welcoming you.",
    cancelledSubject: (r) => `Cancellation ${r}`, cancelledText: (r, m) => `booking ${r} has been cancelled. Refund: ${m}.`,
    preSubject: (h) => `See you soon – ${h}`, preText: (t) => `you arrive in a few days. Check-in from ${t}.`,
    postSubject: (h) => `Thank you for staying – ${h}`, postText: "thank you for your stay. Book direct next time for the best price.", bookAgain: "Book again",
    refundSubject: (r) => `Payment refunded ${r}`, refundText: (m) => `Your payment arrived after the reservation expired and the room was no longer available. We have fully refunded ${m}.`,
  },
  fr: {
    reference: "Numéro de réservation", checkin: "Arrivée", checkout: "Départ", room: "Chambre", guests: "Personnes", children: "enfants", total: "Total", inclTax: "taxe de séjour incluse",
    view: "Voir la réservation", hi: (n) => (n ? `Bonjour ${n}` : "Bonjour"), cancellation: "Annulation",
    confirmedSubject: (r) => `Confirmation de réservation ${r}`, confirmedText: "merci pour votre réservation directe. Nous nous réjouissons de vous accueillir.",
    cancelledSubject: (r) => `Annulation ${r}`, cancelledText: (r, m) => `la réservation ${r} a été annulée. Remboursement : ${m}.`,
    preSubject: (h) => `À très bientôt – ${h}`, preText: (t) => `vous arrivez dans quelques jours. Arrivée possible dès ${t}.`,
    postSubject: (h) => `Merci de votre visite – ${h}`, postText: "merci pour votre séjour. La prochaine fois, réservez en direct pour obtenir le meilleur prix.", bookAgain: "Réserver à nouveau",
    refundSubject: (r) => `Paiement remboursé ${r}`, refundText: (m) => `Votre paiement est arrivé après l'expiration de la réservation et la chambre n'était plus disponible. Nous vous avons remboursé intégralement ${m}.`,
  },
  it: {
    reference: "Numero di prenotazione", checkin: "Arrivo", checkout: "Partenza", room: "Camera", guests: "Persone", children: "bambini", total: "Totale", inclTax: "tassa di soggiorno inclusa",
    view: "Vedi la prenotazione", hi: (n) => (n ? `Buongiorno ${n}` : "Buongiorno"), cancellation: "Annullamento",
    confirmedSubject: (r) => `Conferma di prenotazione ${r}`, confirmedText: "grazie per aver prenotato direttamente. Non vediamo l'ora di accogliervi.",
    cancelledSubject: (r) => `Annullamento ${r}`, cancelledText: (r, m) => `la prenotazione ${r} è stata annullata. Rimborso: ${m}.`,
    preSubject: (h) => `A presto – ${h}`, preText: (t) => `tra pochi giorni arriverete da noi. Check-in dalle ${t}.`,
    postSubject: (h) => `Grazie della visita – ${h}`, postText: "grazie per il vostro soggiorno. La prossima volta prenotate direttamente per il miglior prezzo.", bookAgain: "Prenota di nuovo",
    refundSubject: (r) => `Pagamento rimborsato ${r}`, refundText: (m) => `Il vostro pagamento è arrivato dopo la scadenza della prenotazione e la camera non era più disponibile. Vi abbiamo rimborsato interamente ${m}.`,
  },
  nl: {
    reference: "Boekingsnummer", checkin: "Aankomst", checkout: "Vertrek", room: "Kamer", guests: "Personen", children: "kinderen", total: "Totaal", inclTax: "incl. toeristenbelasting",
    view: "Boeking bekijken", hi: (n) => (n ? `Beste ${n}` : "Hallo"), cancellation: "Annulering",
    confirmedSubject: (r) => `Boekingsbevestiging ${r}`, confirmedText: "hartelijk dank voor uw directe boeking. We kijken uit naar uw bezoek.",
    cancelledSubject: (r) => `Annulering ${r}`, cancelledText: (r, m) => `boeking ${r} is geannuleerd. Terugbetaling: ${m}.`,
    preSubject: (h) => `Tot binnenkort – ${h}`, preText: (t) => `over een paar dagen komt u aan. Inchecken vanaf ${t} uur.`,
    postSubject: (h) => `Bedankt voor uw bezoek – ${h}`, postText: "hartelijk dank voor uw verblijf. Boek de volgende keer direct voor de beste prijs.", bookAgain: "Opnieuw boeken",
    refundSubject: (r) => `Betaling terugbetaald ${r}`, refundText: (m) => `Uw betaling kwam binnen nadat de reservering was verlopen en de kamer was niet meer vrij. We hebben ${m} volledig terugbetaald.`,
  },
};

function summary(c: EmailContext, l: Locale): string[] {
  const b = c.booking;
  if (!b) return [];
  const m = G[l];
  return [
    `${m.reference}: ${b.reference}`,
    `${m.checkin}: ${formatDay(b.checkin, l)} (${c.hotel.checkinTime.slice(0, 5)})`,
    `${m.checkout}: ${formatDay(b.checkout, l)} (${c.hotel.checkoutTime.slice(0, 5)})`,
    `${m.room}: ${c.roomType ? roomName(c.roomType, l) : "-"}${c.plan ? ` · ${planName(c.plan, l)}` : ""}`,
    `${m.guests}: ${b.adults}${b.children ? ` + ${b.children} ${m.children}` : ""}`,
    `${m.total}: ${formatChf(b.totalRappen)}${b.touristTaxRappen ? ` (${m.inclTax} ${formatChf(b.touristTaxRappen)})` : ""}`,
    ...(b.voucherRappen > 0 ? [`${t(l).voucherPaid}: − ${formatChf(b.voucherRappen)}`, `${t(l).cardPaid}: ${formatChf(b.totalRappen - b.voucherRappen)}`] : []),
  ];
}

function wrap(c: EmailContext, l: Locale, subject: string, paras: string[], lines: string[] = [], link?: { href: string; label: string }): Rendered {
  const text = [...paras, "", ...lines, link ? `\n${link.label}: ${link.href}` : "", "", c.hotel.name, c.hotel.contactEmail].join("\n");
  const html = `<!doctype html><html lang="${l}"><body style="font-family:Arial,sans-serif;color:#1f2a2e;max-width:560px;margin:0 auto;padding:16px">
<h2 style="font-family:Georgia,serif">${esc(c.hotel.name)}</h2>
${paras.map((p) => `<p>${esc(p)}</p>`).join("")}
${lines.length ? `<table style="border-collapse:collapse;width:100%">${lines.map((x) => { const [k, ...v] = x.split(": "); return `<tr><td style="padding:4px 0;color:#5f6b70">${esc(k)}</td><td style="padding:4px 0;text-align:right">${esc(v.join(": "))}</td></tr>`; }).join("")}</table>` : ""}
${link ? `<p style="margin-top:24px"><a href="${esc(link.href)}" style="background:#2f5d50;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(link.label)}</a></p>` : ""}
<p style="color:#5f6b70;font-size:13px;margin-top:32px">${esc(c.hotel.name)} · ${esc(c.hotel.contactEmail)}${c.hotel.contactPhone ? " · " + esc(c.hotel.contactPhone) : ""}</p>
</body></html>`;
  return { subject, text, html };
}

/** Gutschein- und Anfrage-Mails an Gäste */
const X: Record<Locale, {
  vSubject: (h: string) => string; vText: (amount: string, until: string) => string; vOpen: string;
  iSubject: (h: string) => string; iText: string;
}> = {
  de: { vSubject: (h) => `Ihr Gutschein – ${h}`, vText: (a, u) => `vielen Dank für Ihren Gutschein über ${a}. Er ist gültig bis ${u}. Über den Link können Sie ihn ansehen und ausdrucken.`, vOpen: "Gutschein ansehen und drucken",
    iSubject: (h) => `Ihre Anfrage – ${h}`, iText: "vielen Dank für Ihre Anfrage. Sie ist bei uns angekommen, wir melden uns so rasch wie möglich." },
  en: { vSubject: (h) => `Your gift voucher – ${h}`, vText: (a, u) => `thank you for your gift voucher worth ${a}. It is valid until ${u}. Use the link to view and print it.`, vOpen: "View and print voucher",
    iSubject: (h) => `Your request – ${h}`, iText: "thank you for your request. We have received it and will get back to you as soon as possible." },
  fr: { vSubject: (h) => `Votre bon cadeau – ${h}`, vText: (a, u) => `merci pour votre bon cadeau d'une valeur de ${a}. Il est valable jusqu'au ${u}. Le lien vous permet de le consulter et de l'imprimer.`, vOpen: "Voir et imprimer le bon",
    iSubject: (h) => `Votre demande – ${h}`, iText: "merci pour votre demande. Elle nous est bien parvenue, nous vous répondrons dès que possible." },
  it: { vSubject: (h) => `Il vostro buono regalo – ${h}`, vText: (a, u) => `grazie per il buono regalo di ${a}. È valido fino al ${u}. Con il link potete vederlo e stamparlo.`, vOpen: "Vedi e stampa il buono",
    iSubject: (h) => `La vostra richiesta – ${h}`, iText: "grazie per la vostra richiesta. È arrivata, vi risponderemo il prima possibile." },
  nl: { vSubject: (h) => `Uw cadeaubon – ${h}`, vText: (a, u) => `hartelijk dank voor uw cadeaubon van ${a}. Hij is geldig tot ${u}. Via de link kunt u hem bekijken en afdrukken.`, vOpen: "Bon bekijken en afdrukken",
    iSubject: (h) => `Uw aanvraag – ${h}`, iText: "hartelijk dank voor uw aanvraag. We hebben hem ontvangen en nemen zo snel mogelijk contact op." },
};

const KIND_DE: Record<string, string> = { group: "Gruppe", seminar: "Seminar / Tagung", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anderes" };

export function render(template: string, lang: string, c: EmailContext): Rendered {
  // Gäste-Mails in jeder Website-Sprache; Hotel-interne Mails nur DE/EN
  const gl: Locale = isLocale(lang) ? lang : "de";
  const l: Locale = gl === "de" || gl === "en" ? gl : "en";
  const de = l === "de";
  const m = G[gl];
  const b = c.booking;
  const link = b ? { href: `${c.baseUrl}/b/${b.publicToken}`, label: m.view } : undefined;
  const hi = m.hi(c.guestName);
  const money = (k: string) => formatChf(Number(c.data[k] ?? 0));
  const ref = b?.reference ?? "";

  switch (template) {
    case "booking_confirmed":
      return wrap(c, gl, m.confirmedSubject(ref), [hi + ",", m.confirmedText],
        [...summary(c, gl), ...(c.plan ? [`${m.cancellation}: ${cancellationPolicyText(c.plan, gl)}`] : [])], link);
    case "hotel_new_booking":
      return wrap(c, l, `${de ? "Neue Buchung" : "New booking"} ${b?.reference} (${b?.source})`,
        [de ? `Neue Buchung von ${c.guestName ?? "Gast"} über ${b?.source}.` : `New booking from ${c.guestName ?? "guest"} via ${b?.source}.`],
        summary(c, l));
    case "booking_cancelled":
      return wrap(c, gl, m.cancelledSubject(ref), [hi + ",", m.cancelledText(ref, money("refundRappen"))],
        [...(Number(c.data.voucherBackRappen ?? 0) > 0 ? [`${t(gl).voucherPaid} (+): ${money("voucherBackRappen")}`] : []), ...summary(c, gl)], link);
    case "pre_arrival":
      return wrap(c, gl, m.preSubject(c.hotel.name), [hi + ",", m.preText(c.hotel.checkinTime.slice(0, 5))], summary(c, gl), link);
    case "post_stay":
      return wrap(c, gl, m.postSubject(c.hotel.name), [hi + ",", m.postText], [], { href: c.baseUrl, label: m.bookAgain });
    case "overbooking_alert":
      return wrap(c, l, `${de ? "ÜBERBUCHUNG" : "OVERBOOKING"} ${b?.reference ?? ""}`,
        [de ? "Eine Buchung aus einem Portal hat eine Überbuchung erzeugt. Bitte sofort prüfen." : "A channel booking caused an overbooking. Please check immediately."], summary(c, l));
    case "late_payment_refunded":
      return wrap(c, gl, m.refundSubject(ref), [hi + ",", m.refundText(money("refundRappen"))], summary(c, gl));
    case "dispute_alert":
      return wrap(c, l, de ? "Zahlung angefochten (Dispute)" : "Payment disputed",
        [de ? `Eine Zahlung über ${money("amountRappen")} wurde angefochten (Grund: ${c.data.reason}). Bitte im Stripe-Dashboard reagieren.` : `A payment of ${money("amountRappen")} was disputed (reason: ${c.data.reason}). Please respond in the Stripe dashboard.`], summary(c, l));
    case "login_link":
      return wrap(c, l, de ? "Ihr Login-Link" : "Your login link",
        [de ? "Klicken Sie auf den Link, um sich anzumelden. Er ist 15 Minuten gültig und nur einmal verwendbar." : "Click the link to sign in. It is valid for 15 minutes and can be used once."],
        [], { href: String(c.data.link), label: de ? "Anmelden" : "Sign in" });
    case "voucher_purchased": {
      const x = X[gl];
      return wrap(c, gl, x.vSubject(c.hotel.name),
        [m.hi(String(c.data.buyer ?? "")) + ",", x.vText(money("amountRappen"), formatDay(String(c.data.validUntil), gl))],
        [`${t(gl).vCode}: ${c.data.code}`], { href: `${c.baseUrl}/v/${c.data.token}`, label: x.vOpen });
    }
    case "hotel_voucher_sold":
      return wrap(c, l, `${de ? "Gutschein verkauft" : "Voucher sold"} ${c.data.code} – ${money("amountRappen")}`,
        [de ? `${c.data.buyer} hat einen Gutschein über ${money("amountRappen")} gekauft${c.data.recipient ? ` (für ${c.data.recipient})` : ""}. Einlösen unter Admin → Gutscheine.` : `${c.data.buyer} bought a voucher worth ${money("amountRappen")}${c.data.recipient ? ` (for ${c.data.recipient})` : ""}. Redeem under Admin → Vouchers.`],
        [`Code: ${c.data.code}`, `${de ? "Gültig bis" : "Valid until"}: ${formatDay(String(c.data.validUntil), l)}`]);
    case "inquiry_received": {
      const d = c.data as Record<string, string | number | null>;
      return wrap(c, l, `${de ? "Neue Anfrage" : "New request"}: ${KIND_DE[String(d.kind)] ?? d.kind} – ${d.name}`,
        [de ? "Über die Website ist eine Anfrage eingegangen. Antworten Sie direkt an die E-Mail-Adresse des Gastes." : "A request came in through the website. Reply directly to the guest's email address.", String(d.message ?? "")],
        [`${de ? "Anlass" : "Occasion"}: ${KIND_DE[String(d.kind)] ?? d.kind}`, `${de ? "Name" : "Name"}: ${d.name}`, `E-Mail: ${d.email}`, ...(d.phone ? [`${de ? "Telefon" : "Phone"}: ${d.phone}`] : []),
          ...(d.dateFrom ? [`${de ? "Datum" : "Date"}: ${formatDay(String(d.dateFrom), l)}${d.dateTo ? ` – ${formatDay(String(d.dateTo), l)}` : ""}`] : []), ...(d.persons ? [`${de ? "Personen" : "Guests"}: ${d.persons}`] : [])]);
    }
    case "inquiry_confirmation": {
      const x = X[gl];
      return wrap(c, gl, x.iSubject(c.hotel.name), [m.hi(String(c.data.name ?? "")) + ",", x.iText, String(c.data.message ?? "")]);
    }
    case "channex_alert":
      return wrap(c, l, `[Channex] ${String(c.data.subject)}${c.data.hotel ? ` – ${c.data.hotel}` : ""}`,
        [String(c.data.subject), String(c.data.details ?? "")]);
    default:
      throw new Error(`Unbekanntes Template ${template}`);
  }
}
