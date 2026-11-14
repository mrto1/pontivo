import { formatChf } from "../domain/money";
import { feePercentText } from "../domain/fee";
import { cancellationPolicyText } from "../domain/cancellation";
import { formatDay, isLocale, t, type Locale } from "../i18n/dict";
import type { Booking, Hotel, RatePlan, RoomType } from "../db/schema";
import { planName, roomName } from "../domain/i18n-names";
import { CI } from "../i18n/checkin";
import { env } from "../env";
import { tr } from "../domain/blocks";
import { U } from "../i18n/upsell";

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
  /** gebuchte Zusatzleistungen */
  extras?: { name: Partial<Record<Locale, string>>; quantity: number; amountRappen: number }[];
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

/** Rechnung per E-Mail (SPEC 16.3) */
const IM: Record<Locale, { invoiceWord: string; creditWord: string; invoiceText: string; creditText: string; amount: string; open: string }> = {
  de: { invoiceWord: "Rechnung", creditWord: "Gutschrift", invoiceText: "anbei erhalten Sie die Rechnung zu Ihrem Aufenthalt. Über den Link können Sie sie ansehen, ausdrucken oder als PDF speichern.", creditText: "wir haben eine Gutschrift zu Ihrer Rechnung ausgestellt. Über den Link können Sie sie ansehen, ausdrucken oder als PDF speichern.", amount: "Betrag", open: "Rechnung ansehen" },
  en: { invoiceWord: "Invoice", creditWord: "Credit note", invoiceText: "please find the invoice for your stay at the link below. You can view it, print it or save it as a PDF.", creditText: "we have issued a credit note for your invoice. You can view it, print it or save it as a PDF at the link below.", amount: "Amount", open: "View invoice" },
  fr: { invoiceWord: "Facture", creditWord: "Note de crédit", invoiceText: "vous trouverez la facture de votre séjour via le lien ci-dessous. Vous pouvez la consulter, l'imprimer ou l'enregistrer en PDF.", creditText: "nous avons établi une note de crédit pour votre facture. Le lien vous permet de la consulter, de l'imprimer ou de l'enregistrer en PDF.", amount: "Montant", open: "Voir la facture" },
  it: { invoiceWord: "Fattura", creditWord: "Nota di credito", invoiceText: "trovate la fattura del vostro soggiorno al link qui sotto. Potete vederla, stamparla o salvarla come PDF.", creditText: "abbiamo emesso una nota di credito per la vostra fattura. Con il link potete vederla, stamparla o salvarla come PDF.", amount: "Importo", open: "Vedi la fattura" },
  nl: { invoiceWord: "Factuur", creditWord: "Creditnota", invoiceText: "via de link hieronder vindt u de factuur voor uw verblijf. U kunt hem bekijken, afdrukken of als pdf opslaan.", creditText: "wij hebben een creditnota voor uw factuur opgesteld. Via de link kunt u hem bekijken, afdrukken of als pdf opslaan.", amount: "Bedrag", open: "Factuur bekijken" },
};

/** Anzahlung und Restzahlung (SPEC 5.9) */
const B: Record<Locale, {
  paidNow: string; open: string; dueSubject: (r: string) => string; dueText: (amount: string, date: string) => string; remSubject: (r: string) => string;
  remText: (amount: string, date: string) => string; pay: string; paidSubject: (r: string) => string; paidText: (amount: string) => string;
}> = {
  de: { paidNow: "Anzahlung bezahlt", open: "Restbetrag", dueSubject: (r) => `Restzahlung für Ihre Buchung ${r}`, dueText: (a, d) => `für Ihren Aufenthalt ist noch ein Restbetrag von ${a} offen (fällig am ${d}). Sie können ihn mit einem Klick online bezahlen.`,
    remSubject: (r) => `Erinnerung: Restzahlung ${r}`, remText: (a, d) => `freundliche Erinnerung: der Restbetrag von ${a} für Ihren Aufenthalt war am ${d} fällig. Bitte bezahlen Sie ihn online oder bei der Ankunft nach Absprache mit dem Hotel.`, pay: "Restbetrag bezahlen",
    paidSubject: (r) => `Restzahlung erhalten ${r}`, paidText: (a) => `vielen Dank, wir haben Ihre Restzahlung von ${a} erhalten. Ihre Buchung ist vollständig bezahlt.` },
  en: { paidNow: "Deposit paid", open: "Balance", dueSubject: (r) => `Balance payment for your booking ${r}`, dueText: (a, d) => `a balance of ${a} is still open for your stay (due ${d}). You can pay it online with one click.`,
    remSubject: (r) => `Reminder: balance payment ${r}`, remText: (a, d) => `friendly reminder: the balance of ${a} for your stay was due on ${d}. Please pay it online or on arrival after agreeing with the hotel.`, pay: "Pay balance",
    paidSubject: (r) => `Balance payment received ${r}`, paidText: (a) => `thank you, we have received your balance payment of ${a}. Your booking is fully paid.` },
  fr: { paidNow: "Acompte payé", open: "Solde", dueSubject: (r) => `Paiement du solde de votre réservation ${r}`, dueText: (a, d) => `un solde de ${a} reste à payer pour votre séjour (échéance ${d}). Vous pouvez le régler en ligne en un clic.`,
    remSubject: (r) => `Rappel : paiement du solde ${r}`, remText: (a, d) => `petit rappel : le solde de ${a} pour votre séjour était dû le ${d}. Merci de le régler en ligne ou à l'arrivée après accord avec l'hôtel.`, pay: "Payer le solde",
    paidSubject: (r) => `Solde reçu ${r}`, paidText: (a) => `merci, nous avons bien reçu le paiement du solde de ${a}. Votre réservation est entièrement payée.` },
  it: { paidNow: "Acconto pagato", open: "Saldo", dueSubject: (r) => `Pagamento del saldo per la prenotazione ${r}`, dueText: (a, d) => `per il vostro soggiorno è ancora aperto un saldo di ${a} (scadenza ${d}). Potete pagarlo online con un clic.`,
    remSubject: (r) => `Promemoria: pagamento del saldo ${r}`, remText: (a, d) => `gentile promemoria: il saldo di ${a} per il vostro soggiorno era in scadenza il ${d}. Vi preghiamo di pagarlo online o all'arrivo previo accordo con l'hotel.`, pay: "Paga il saldo",
    paidSubject: (r) => `Saldo ricevuto ${r}`, paidText: (a) => `grazie, abbiamo ricevuto il saldo di ${a}. La prenotazione è interamente pagata.` },
  nl: { paidNow: "Aanbetaling voldaan", open: "Restbedrag", dueSubject: (r) => `Restbetaling voor uw boeking ${r}`, dueText: (a, d) => `voor uw verblijf staat nog een restbedrag van ${a} open (te betalen op ${d}). U kunt het met één klik online betalen.`,
    remSubject: (r) => `Herinnering: restbetaling ${r}`, remText: (a, d) => `vriendelijke herinnering: het restbedrag van ${a} voor uw verblijf moest op ${d} betaald zijn. Betaal het online of bij aankomst in overleg met het hotel.`, pay: "Restbedrag betalen",
    paidSubject: (r) => `Restbetaling ontvangen ${r}`, paidText: (a) => `hartelijk dank, we hebben uw restbetaling van ${a} ontvangen. Uw boeking is volledig betaald.` },
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
    ...(c.extras ?? []).map((x) => `${tr(x.name, l)}${x.quantity > 1 ? ` × ${x.quantity}` : ""}: ${formatChf(x.amountRappen)}`),
    `${m.total}: ${formatChf(b.totalRappen)}${b.touristTaxRappen ? ` (${m.inclTax} ${formatChf(b.touristTaxRappen)})` : ""}`,
    ...(b.voucherRappen > 0 ? [`${t(l).voucherPaid}: − ${formatChf(b.voucherRappen)}`, `${t(l).cardPaid}: ${formatChf(b.totalRappen - b.voucherRappen)}`] : []),
    ...(b.balanceRappen > 0 && !b.balancePaidAt && !b.balanceOnsiteAt
      ? [`${B[l].paidNow}: ${formatChf(b.totalRappen - b.voucherRappen - b.balanceRappen)}`, `${B[l].open}: ${formatChf(b.balanceRappen)}${b.balanceDueOn ? ` (${formatDay(b.balanceDueOn, l)})` : ""}`]
      : []),
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
  tSubject: (h: string) => string; tText: string; tDate: string; tTime: string; tPersons: string;
}> = {
  de: { vSubject: (h) => `Ihr Gutschein – ${h}`, vText: (a, u) => `vielen Dank für Ihren Gutschein über ${a}. Er ist gültig bis ${u}. Über den Link können Sie ihn ansehen und ausdrucken.`, vOpen: "Gutschein ansehen und drucken",
    iSubject: (h) => `Ihre Anfrage – ${h}`, iText: "vielen Dank für Ihre Anfrage. Sie ist bei uns angekommen, wir melden uns so rasch wie möglich.", tSubject: (h) => `Ihre Tischreservation – ${h}`, tText: "vielen Dank für Ihre Reservationsanfrage. Sie gilt, sobald wir sie bestätigt haben – wir melden uns so rasch wie möglich.", tDate: "Datum", tTime: "Uhrzeit", tPersons: "Personen" },
  en: { vSubject: (h) => `Your gift voucher – ${h}`, vText: (a, u) => `thank you for your gift voucher worth ${a}. It is valid until ${u}. Use the link to view and print it.`, vOpen: "View and print voucher",
    iSubject: (h) => `Your request – ${h}`, iText: "thank you for your request. We have received it and will get back to you as soon as possible.", tSubject: (h) => `Your table reservation – ${h}`, tText: "thank you for your reservation request. It is valid once we have confirmed it – we will get back to you as soon as possible.", tDate: "Date", tTime: "Time", tPersons: "Guests" },
  fr: { vSubject: (h) => `Votre bon cadeau – ${h}`, vText: (a, u) => `merci pour votre bon cadeau d'une valeur de ${a}. Il est valable jusqu'au ${u}. Le lien vous permet de le consulter et de l'imprimer.`, vOpen: "Voir et imprimer le bon",
    iSubject: (h) => `Votre demande – ${h}`, iText: "merci pour votre demande. Elle nous est bien parvenue, nous vous répondrons dès que possible.", tSubject: (h) => `Votre réservation de table – ${h}`, tText: "merci pour votre demande de réservation. Elle est valable dès que nous l'avons confirmée – nous vous répondrons dès que possible.", tDate: "Date", tTime: "Heure", tPersons: "Personnes" },
  it: { vSubject: (h) => `Il vostro buono regalo – ${h}`, vText: (a, u) => `grazie per il buono regalo di ${a}. È valido fino al ${u}. Con il link potete vederlo e stamparlo.`, vOpen: "Vedi e stampa il buono",
    iSubject: (h) => `La vostra richiesta – ${h}`, iText: "grazie per la vostra richiesta. È arrivata, vi risponderemo il prima possibile.", tSubject: (h) => `La vostra prenotazione del tavolo – ${h}`, tText: "grazie per la richiesta di prenotazione. È valida non appena l'abbiamo confermata – vi risponderemo il prima possibile.", tDate: "Data", tTime: "Ora", tPersons: "Persone" },
  nl: { vSubject: (h) => `Uw cadeaubon – ${h}`, vText: (a, u) => `hartelijk dank voor uw cadeaubon van ${a}. Hij is geldig tot ${u}. Via de link kunt u hem bekijken en afdrukken.`, vOpen: "Bon bekijken en afdrukken",
    iSubject: (h) => `Uw aanvraag – ${h}`, iText: "hartelijk dank voor uw aanvraag. We hebben hem ontvangen en nemen zo snel mogelijk contact op.", tSubject: (h) => `Uw tafelreservering – ${h}`, tText: "hartelijk dank voor uw reserveringsaanvraag. Die is geldig zodra wij hem hebben bevestigd – we nemen zo snel mogelijk contact op.", tDate: "Datum", tTime: "Tijd", tPersons: "Personen" },
};

const KIND_DE: Record<string, string> = { table: "Tisch reservieren", group: "Gruppe", seminar: "Seminar / Tagung", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anderes" };

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
    case "balance_due":
    case "balance_reminder": {
      const bm = B[gl];
      const amount = formatChf(b?.balanceRappen ?? 0);
      const date = b?.balanceDueOn ? formatDay(b.balanceDueOn, gl) : "";
      const first = template === "balance_due";
      return wrap(c, gl, first ? bm.dueSubject(ref) : bm.remSubject(ref), [hi + ",", first ? bm.dueText(amount, date) : bm.remText(amount, date)], summary(c, gl),
        b ? { href: `${c.baseUrl}/b/${b.publicToken}`, label: bm.pay } : undefined);
    }
    case "invoice_sent": {
      const n = String(c.data.number ?? "");
      const credit = c.data.kind === "credit_note";
      const href = b && c.data.invoiceId ? `${c.baseUrl}/b/${b.publicToken}/rechnung/${c.data.invoiceId}` : undefined;
      const m = IM[gl];
      return wrap(c, gl, `${credit ? m.creditWord : m.invoiceWord} ${n} – ${c.hotel.name}`, [hi + ",", credit ? m.creditText : m.invoiceText], [`${m.amount}: ${money("totalRappen")}`], href ? { href, label: m.open } : undefined);
    }
    case "balance_paid":
      return wrap(c, gl, B[gl].paidSubject(ref), [hi + ",", B[gl].paidText(money("amountRappen"))], summary(c, gl), link);
    case "hotel_balance_open":
      return wrap(c, l, `${de ? "Restzahlung offen" : "Balance payment open"} ${ref}`,
        [de ? `Der Restbetrag ${formatChf(b?.balanceRappen ?? 0)} von ${c.guestName ?? "Gast"} ist noch offen, die Anreise ist am ${b ? formatDay(b.checkin, l) : ""}. Bitte beim Gast nachfragen oder vor Ort einziehen und in der Buchung als erhalten markieren.`
          : `The balance ${formatChf(b?.balanceRappen ?? 0)} from ${c.guestName ?? "guest"} is still open, arrival is ${b ? formatDay(b.checkin, l) : ""}. Please ask the guest or collect it on site and mark it as received in the booking.`], summary(c, l));
    case "hotel_new_booking":
      return wrap(c, l, `${de ? "Neue Buchung" : "New booking"} ${b?.reference} (${b?.source})`,
        [de ? `Neue Buchung von ${c.guestName ?? "Gast"} über ${b?.source}.` : `New booking from ${c.guestName ?? "guest"} via ${b?.source}.`],
        summary(c, l));
    case "booking_cancelled":
      return wrap(c, gl, m.cancelledSubject(ref), [hi + ",", m.cancelledText(ref, money("refundRappen"))],
        [...(Number(c.data.voucherBackRappen ?? 0) > 0 ? [`${t(gl).voucherPaid} (+): ${money("voucherBackRappen")}`] : []), ...summary(c, gl)], link);
    case "pre_arrival": {
      // Infos zur Ankunft (Schlüssel, Code, WLAN …) aus dem Einrichtungs-Assistenten
      const arrival = c.roomType?.arrivalInfo?.trim() || tr(c.hotel.content.arrivalInfo, gl);
      return wrap(c, gl, m.preSubject(c.hotel.name), [hi + ",", m.preText(c.hotel.checkinTime.slice(0, 5)), ...(arrival ? arrival.split(/\n\s*\n/) : [])], summary(c, gl), link);
    }
    case "checkin_link": {
      const ci = CI[gl];
      return wrap(c, gl, `${ci.title} – ${c.hotel.name}`, [hi + ",", ci.linkText], summary(c, gl),
        b ? { href: `${c.baseUrl}/b/${b.publicToken}/checkin`, label: ci.linkButton } : undefined);
    }
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
    case "upsell_offer": {
      const u = U[gl];
      return wrap(c, gl, u.mailSubject(c.hotel.name), [hi + ",", u.mailText], summary(c, gl), b ? { href: `${c.baseUrl}/b/${b.publicToken}/upsell`, label: u.mailButton } : undefined);
    }
    case "upsell_paid": {
      const u = U[gl];
      const lines = (c.data.lines as { name: Partial<Record<Locale, string>>; quantity: number; amountRappen: number }[] | undefined) ?? [];
      return wrap(c, gl, u.paidSubject(c.hotel.name), [hi + ",", u.paidText(money("amountRappen"))],
        [...lines.map((x) => `${x.quantity}× ${tr(x.name, gl)}: ${formatChf(x.amountRappen)}`), ...summary(c, gl)], link);
    }
    case "hotel_upsell_sold": {
      const lines = (c.data.lines as { name: Partial<Record<Locale, string>>; quantity: number; amountRappen: number }[] | undefined) ?? [];
      return wrap(c, l, `${de ? "Extras verkauft" : "Extras sold"} ${ref} – ${money("amountRappen")}`,
        [de ? `${c.guestName ?? "Ein Gast"} hat Extras über ${money("amountRappen")} gekauft (Buchung ${ref}). Bitte bereitstellen.` : `${c.guestName ?? "A guest"} bought extras worth ${money("amountRappen")} (booking ${ref}). Please prepare them.`],
        lines.map((x) => `${x.quantity}× ${tr(x.name, l)}: ${formatChf(x.amountRappen)}`));
    }
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
          ...(d.dateFrom ? [`${de ? "Datum" : "Date"}: ${formatDay(String(d.dateFrom), l)}${d.dateTo ? ` – ${formatDay(String(d.dateTo), l)}` : ""}`] : []), ...(d.timeOfDay ? [`${de ? "Uhrzeit" : "Time"}: ${d.timeOfDay}`] : []), ...(d.persons ? [`${de ? "Personen" : "Guests"}: ${d.persons}`] : [])]);
    }
    case "inquiry_confirmation": {
      const x = X[gl];
      if (c.data.kind === "table") {
        return wrap(c, gl, x.tSubject(c.hotel.name), [m.hi(String(c.data.name ?? "")) + ",", x.tText, String(c.data.message ?? "")],
          [`${x.tDate}: ${formatDay(String(c.data.dateFrom), gl)}`, `${x.tTime}: ${c.data.timeOfDay}`, `${x.tPersons}: ${c.data.persons}`]);
      }
      return wrap(c, gl, x.iSubject(c.hotel.name), [m.hi(String(c.data.name ?? "")) + ",", x.iText, String(c.data.message ?? "")]);
    }
    case "host_welcome": {
      const admin = env().APP_BASE_URL;
      return wrap(c, l, de ? `Willkommen bei ${env().PLATFORM_NAME} – so geht es weiter` : `Welcome to ${env().PLATFORM_NAME} – next steps`,
        de ? [`Guten Tag ${c.data.contactName ?? ""}`.trim() + ",", `schön, dass ${c.hotel.name} dabei ist. Der Einrichtungs-Assistent führt Sie in etwa 20 Minuten durch alles: Angaben, Kurtaxe, ${c.hotel.propertyType === "hotel" || c.hotel.propertyType === "bnb" ? "Zimmer" : "Unterkunft"}, Preise, Fotos und Zahlungen. Sie können jederzeit unterbrechen und später weitermachen.${c.data.mode === "booking_only" ? " Ihre eigene Website bleibt bestehen – am Schluss zeigen wir Ihnen, wie Sie den Link zur Buchung einbauen." : ""}`, "Zum Anmelden erhalten Sie separat einen Login-Link. Später fordern Sie unter dem Link unten jederzeit einen neuen an."]
          : [`Hello ${c.data.contactName ?? ""}`.trim() + ",", `great to have ${c.hotel.name} on board. The setup assistant guides you through everything in about 20 minutes. You can stop at any time and continue later.`],
        [], { href: `${admin}/admin/login`, label: de ? "Anmelden und einrichten" : "Sign in and set up" });
    }
    case "host_onboarding_reminder": {
      const open = (c.data.openSteps as string[] | undefined) ?? [];
      return wrap(c, l, de ? `${c.hotel.name}: Ihre Einrichtung ist fast fertig` : `${c.hotel.name}: your setup is almost done`,
        de ? ["Guten Tag,", `Ihre Einrichtung bei ${env().PLATFORM_NAME} ist noch nicht abgeschlossen. Es fehlen noch: ${open.join(", ") || "nur noch das Live-Schalten"}.`, "Bei Fragen antworten Sie einfach auf diese E-Mail."]
          : ["Hello,", `your setup is not finished yet. Still open: ${open.join(", ") || "going live"}.`, "Just reply to this email if you have questions."],
        [], { href: `${env().APP_BASE_URL}/admin/${c.hotel.id}/einrichten`, label: de ? "Einrichtung fortsetzen" : "Continue setup" });
    }
    case "host_live":
      if (c.hotel.content.brand?.mode === "booking_only") {
        return wrap(c, l, de ? `Die Buchung für ${c.hotel.name} ist online` : `Booking for ${c.hotel.name} is live`,
          de ? ["Gratulation!", "Gäste können jetzt direkt bei Ihnen buchen und mit TWINT oder Karte bezahlen.", "Letzter Schritt: auf Ihrer Website einen Link oder Knopf «Buchen» einbauen. Im Assistenten finden Sie den Link und den Code zum Kopieren – oder schicken Sie ihn an Ihre Webagentur."]
            : ["Congratulations!", "Guests can now book directly with you. Last step: add a booking link or button to your website."],
          [], { href: `${env().APP_BASE_URL}/admin/${c.hotel.id}/einrichten?step=einbinden`, label: de ? "Link und Code ansehen" : "Get link and code" });
      }
      return wrap(c, l, de ? `${c.hotel.name} ist online` : `${c.hotel.name} is online`,
        de ? ["Gratulation!", "Ihre Website mit Online-Buchung ist jetzt erreichbar. Gäste können direkt buchen und mit TWINT oder Karte bezahlen.", "Tipps für die ersten Buchungen: Link auf Ihrer bisherigen Website, im Google-Unternehmensprofil und in Ihrer E-Mail-Signatur einfügen. Stammgäste persönlich auf die Direktbuchung hinweisen."]
          : ["Congratulations!", "Your website with online booking is now live. Guests can book directly and pay by TWINT or card."],
        [], { href: c.hotel.primaryDomain ? `https://${c.hotel.primaryDomain}` : `${env().APP_BASE_URL}/h/${c.hotel.slug}/de`, label: de ? "Website ansehen" : "View website" });
    case "host_minimum_charged": {
      const d = c.data as Record<string, string>;
      const pct = feePercentText(c.hotel.platformFeeBps);
      const ai = !!(d.aiModule || d.aiPacks);
      const deParts = [
        d.shortfall ? `Im ${d.month} sind ${pct} % von Direktbuchungen und Gutscheinen von ${d.fees} angefallen. Bis zur Mindestgebühr von ${d.minimum} fehlten ${d.shortfall}.` : "",
        ai ? `KI-Chat: ${[d.aiModule ? `Modul ${d.aiModule}` : "", d.aiPacks ? `Zusatzpakete ${d.aiPacks}` : ""].filter(Boolean).join(", ")}.` : "",
        `Insgesamt wurden ${d.amount} Ihrer Karte ${d.card} belastet.`,
      ].filter(Boolean);
      const enParts = [
        d.shortfall ? `In ${d.month} the ${pct} % fees amounted to ${d.fees}. The difference to the minimum of ${d.minimum} was ${d.shortfall}.` : "",
        ai ? `AI chat: ${[d.aiModule ? `module ${d.aiModule}` : "", d.aiPacks ? `extra packs ${d.aiPacks}` : ""].filter(Boolean).join(", ")}.` : "",
        `A total of ${d.amount} was charged to your card ${d.card}.`,
      ].filter(Boolean);
      return wrap(c, l, de ? `${env().PLATFORM_NAME}: Abrechnung ${d.month}` : `${env().PLATFORM_NAME}: statement ${d.month}`,
        de ? ["Guten Tag,", ...deParts] : ["Hello,", ...enParts],
        [`${de ? "Monat" : "Month"}: ${d.month}`, ...(d.shortfall ? [`${pct} %: ${d.fees}`, `Minimum: ${d.minimum}`] : []), ...(d.aiModule ? [`${de ? "KI-Chat Modul" : "AI chat module"}: ${d.aiModule}`] : []), ...(d.aiPacks ? [`${de ? "KI-Chat Zusatzpakete" : "AI chat extra packs"}: ${d.aiPacks}`] : []), `${de ? "Belastet" : "Charged"}: ${d.amount}`]);
    }
    case "host_charge_failed": {
      const d = c.data as Record<string, string | boolean>;
      return wrap(c, l, de ? `${env().PLATFORM_NAME}: Zahlung fehlgeschlagen` : `${env().PLATFORM_NAME}: payment failed`,
        de ? ["Guten Tag,", `die Abrechnung für ${d.month} (${d.amount}) konnte nicht von Ihrer Karte abgebucht werden. ${d.last ? "Das war der letzte automatische Versuch." : "Wir versuchen es in drei Tagen erneut."} Bitte hinterlegen Sie im Admin eine gültige Karte.`]
          : ["Hello,", `the statement for ${d.month} (${d.amount}) could not be charged to your card. Please add a valid card in the admin.`],
        [], { href: `${env().APP_BASE_URL}/admin/${c.hotel.id}/settings#karte`, label: de ? "Karte erneuern" : "Update card" });
    }
    case "platform_onboarding_alert": {
      const d = c.data as Record<string, unknown>;
      return wrap(c, "de", `[Pontivo] Nachfassen: ${d.hotel}`,
        [`${d.hotel} (${d.propertyType}, ${d.email}) braucht Unterstützung${Number(d.days) ? ` – Einrichtung seit ${d.days} Tagen offen` : ""}.`, `Offen: ${((d.openSteps as string[]) ?? []).join(", ")}`],
        [], { href: `${env().APP_BASE_URL}/admin/${c.hotel.id}/einrichten`, label: "Im Admin ansehen" });
    }
    case "channex_alert":
      return wrap(c, l, `[Channex] ${String(c.data.subject)}${c.data.hotel ? ` – ${c.data.hotel}` : ""}`,
        [String(c.data.subject), String(c.data.details ?? "")]);
    case "platform_alert":
      return wrap(c, "de", `[Pontivo] ${String(c.data.subject)}`, [String(c.data.subject), String(c.data.details ?? "")]);
    default:
      throw new Error(`Unbekanntes Template ${template}`);
  }
}
