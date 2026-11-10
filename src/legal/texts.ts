import type { Hotel } from "../db/schema";
import type { Locale } from "../i18n/dict";
import { env } from "../env";
import { voucherSettings } from "../services/vouchers";

/**
 * AGB und Datenschutzerklärung für die Hotel-Websites (Entwurf, Stand 9.11.2026; Gutscheine, Anfragen ergänzt).
 * Vertragspartner des Gastes ist immer das Hotel; die Plattform ist technischer Dienstleister
 * und bearbeitet Gastdaten im Auftrag des Hotels.
 * WICHTIG: Vor dem produktiven Einsatz durch eine Fachperson prüfen lassen (QUESTIONS.md).
 */

export const LEGAL_VERSION = "2026-11-09";

export type Section = { h: string; p: string[] };
export type LegalDoc = { title: string; intro: string; sections: Section[]; draftNote: string };

export function platformInfo() {
  const e = env();
  const missing = !e.PLATFORM_OPERATOR || !e.PLATFORM_ADDRESS || !e.PLATFORM_CONTACT_EMAIL;
  return {
    name: e.PLATFORM_NAME,
    operator: e.PLATFORM_OPERATOR ?? `[Betreiber ${e.PLATFORM_NAME}]`,
    address: e.PLATFORM_ADDRESS ?? "[Adresse Betreiber]",
    email: e.PLATFORM_CONTACT_EMAIL ?? "[E-Mail Betreiber]",
    hosting: e.HOSTING_PROVIDER ?? "[Hosting-Anbieter, Land]",
    missing,
  };
}

function hotelLine(h: Hotel) {
  return [h.legalName ?? h.name, h.addressLine, [h.postalCode, h.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function terms(h: Hotel, l: Locale): LegalDoc {
  const p = platformInfo();
  const hotel = hotelLine(h);
  const ci = h.checkinTime.slice(0, 5);
  const co = h.checkoutTime.slice(0, 5);
  // ASSUMPTION: AGB/Datenschutz gibt es nur DE und EN (juristisch geprüft werden müssen sie ohnehin); FR/IT/NL zeigen Englisch mit Hinweis.
  const vs = voucherSettings(h);
  const v = vs.enabled;
  const years = vs.validityYears;
  if (l !== "de") {
    return {
      title: "General Terms and Conditions for Guests",
      intro: `These terms apply to accommodation booked directly on this website. Your contracting partner is ${hotel} ("Hotel"). The booking system is operated by ${p.name} (${p.operator}) as a technical service provider on behalf of the Hotel.`,
      draftNote: "Draft – to be reviewed before use.",
      sections: [
        { h: "1. Contract", p: [`The accommodation contract is concluded between you and the Hotel when the payment has been successfully completed${v ? " (or, if a gift voucher covers the full amount, when the booking is confirmed)" : ""} and the booking confirmation is shown. You will also receive the confirmation by email.`, `${p.name} is not a party to the accommodation contract and is not a travel organiser.`] },
        { h: "2. Prices", p: ["All prices are in Swiss francs (CHF) and include statutory VAT. The tourist tax of the municipality is shown separately unless stated as included.", "The price shown at the time of booking applies. Additional services booked on site are charged by the Hotel."] },
        { h: "3. Payment", p: ["Payment is made at the time of booking via the payment provider Stripe (TWINT, card, Apple Pay, Google Pay). The amount is paid directly to the Hotel. Card details are processed only by Stripe and are not stored by the Hotel or the platform.", ...(v ? ["A gift voucher of the Hotel can be applied when booking; only the remaining amount is then paid by TWINT or card (see section 8)."] : [])] },
        { h: "4. Cancellation and no-show", p: ["The cancellation policy of the selected rate applies and is shown before booking and in the confirmation. You can cancel online via the link in your confirmation.", "Within the free cancellation period you receive a full refund. After that, the fee stated in the rate is retained; the tourist tax is always refunded. Non-refundable rates: the room price is not refunded.", "If you do not arrive without cancelling (no-show), the room price is not refunded.", "If the Hotel has to cancel, you receive a full refund. Further claims are governed by the statutory provisions.", "Under Swiss law there is no general right of withdrawal for online bookings. For guests from the EU, the right of withdrawal does not apply to accommodation services for specific dates."] },
        { h: "5. Arrival and departure", p: [`Rooms are available from ${ci} on the day of arrival and must be vacated by ${co} on the day of departure, unless agreed otherwise.`, "By law, the Hotel must register guests. Please bring an official identity document."] },
        { h: "6. Liability", p: ["The Hotel is liable in accordance with the statutory provisions (in particular Art. 487 ff. of the Swiss Code of Obligations for items brought in). Liability for slight negligence is excluded to the extent permitted by law.", `${p.name} is only liable for the proper technical operation of the booking system and to the extent permitted by law.`] },
        { h: "7. Data protection", p: ["Information on how your personal data is processed can be found in the privacy policy on this website."] },
        ...(v ? [{ h: "8. Gift vouchers", p: [
          "Gift vouchers are value vouchers issued by the Hotel; your contracting partner for the purchase is the Hotel. The voucher is issued once the payment has been completed and is sent to you by email with a code and a printable version.",
          `The voucher is valid for ${years} year(s) from purchase; the expiry date is printed on it. What counts is the date of booking or of redemption at the Hotel: if you book before the expiry date, the voucher also applies to a stay after that date.`,
          "The voucher can be redeemed online when booking on this website or at the Hotel for accommodation and other services of the Hotel, also in several partial amounts. Any remaining value stays valid until the expiry date. Cash payment of the voucher is excluded to the extent permitted by law.",
          "The voucher is transferable. Anyone who knows the code can redeem it, so please keep it safe. The Hotel is only liable for redemption by unauthorised persons if you reported the loss beforehand.",
          "If a booking paid (partly) with a voucher is cancelled, the refund is determined by the cancellation policy (section 4) and split in proportion to the means of payment: the voucher share is credited back to the voucher (expiry date unchanged), the remainder is refunded to the original means of payment. If a reservation expires without payment, the voucher amount is credited back automatically.",
          "Vouchers that have been purchased cannot be returned. Under Swiss law there is no statutory right of withdrawal; mandatory withdrawal rights for consumers resident in the EU remain reserved.",
        ] }] : []),
        { h: `${v ? 9 : 8}. Applicable law and jurisdiction`, p: ["Swiss law applies. Place of jurisdiction is the registered office of the Hotel; mandatory places of jurisdiction for consumers remain reserved."] },
      ],
    };
  }
  return {
    title: "Allgemeine Geschäftsbedingungen (AGB) für Gäste",
    intro: `Diese AGB gelten für Übernachtungen, die direkt über diese Website gebucht werden. Ihr Vertragspartner ist ${hotel} («Hotel»). Das Buchungssystem wird von ${p.name} (${p.operator}) als technischer Dienstleister im Auftrag des Hotels betrieben.`,
    draftNote: "Entwurf – vor Verwendung rechtlich prüfen lassen.",
    sections: [
      { h: "1. Vertragsschluss", p: [`Der Beherbergungsvertrag kommt zwischen Ihnen und dem Hotel zustande, sobald die Zahlung erfolgreich abgeschlossen ist${v ? " (oder, wenn ein Gutschein den ganzen Betrag deckt, sobald die Buchung bestätigt ist)" : ""} und die Buchungsbestätigung angezeigt wird. Die Bestätigung erhalten Sie zusätzlich per E-Mail.`, `${p.name} ist nicht Partei des Beherbergungsvertrags und kein Reiseveranstalter.`] },
      { h: "2. Preise", p: ["Alle Preise verstehen sich in Schweizer Franken (CHF) inklusive gesetzlicher Mehrwertsteuer. Die Kurtaxe der Gemeinde wird separat ausgewiesen, ausser sie ist als inbegriffen bezeichnet.", "Es gilt der bei der Buchung angezeigte Preis. Vor Ort bezogene Zusatzleistungen verrechnet das Hotel separat."] },
      { h: "3. Zahlung", p: ["Die Zahlung erfolgt bei der Buchung über den Zahlungsdienstleister Stripe (TWINT, Karte, Apple Pay, Google Pay). Der Betrag geht direkt an das Hotel. Kartendaten werden ausschliesslich von Stripe verarbeitet und weder vom Hotel noch von der Plattform gespeichert.", ...(v ? ["Ein Gutschein des Hotels kann bei der Buchung angerechnet werden; mit TWINT oder Karte bezahlen Sie dann nur den Restbetrag (Ziffer 8)."] : [])] },
      { h: "4. Stornierung und Nichtanreise", p: ["Es gelten die Stornobedingungen des gewählten Angebots; sie werden vor der Buchung und in der Bestätigung angezeigt. Sie können online über den Link in Ihrer Bestätigung stornieren.", "Innerhalb der kostenlosen Stornofrist erhalten Sie den vollen Betrag zurück. Danach wird die im Angebot genannte Gebühr einbehalten; die Kurtaxe wird immer zurückerstattet. Bei nicht stornierbaren Angeboten wird der Zimmerpreis nicht erstattet.", "Reisen Sie ohne Stornierung nicht an (No-Show), wird der Zimmerpreis nicht erstattet.", "Muss das Hotel eine Buchung stornieren, erhalten Sie den vollen Betrag zurück. Weitergehende Ansprüche richten sich nach den gesetzlichen Bestimmungen.", "Nach Schweizer Recht besteht bei Online-Buchungen kein allgemeines Widerrufsrecht. Für Gäste aus der EU gilt das Widerrufsrecht bei Beherbergungsleistungen zu festen Daten nicht."] },
      { h: "5. An- und Abreise", p: [`Die Zimmer stehen am Anreisetag ab ${ci} Uhr zur Verfügung und sind am Abreisetag bis ${co} Uhr zu räumen, sofern nichts anderes vereinbart ist.`, "Das Hotel ist gesetzlich verpflichtet, Gäste zu registrieren. Bitte bringen Sie einen amtlichen Ausweis mit."] },
      { h: "6. Haftung", p: ["Das Hotel haftet nach den gesetzlichen Bestimmungen (insbesondere Art. 487 ff. OR für eingebrachte Sachen). Die Haftung für leichte Fahrlässigkeit ist, soweit gesetzlich zulässig, ausgeschlossen.", `${p.name} haftet nur für den ordnungsgemässen technischen Betrieb des Buchungssystems und nur soweit gesetzlich zulässig.`] },
      { h: "7. Datenschutz", p: ["Wie Ihre Personendaten bearbeitet werden, steht in der Datenschutzerklärung auf dieser Website."] },
      ...(v ? [{ h: "8. Gutscheine", p: [
        "Gutscheine des Hotels sind Wertgutscheine. Sie werden vom Hotel ausgegeben; Vertragspartner beim Kauf ist das Hotel. Der Gutschein wird ausgestellt, sobald die Zahlung abgeschlossen ist, und Ihnen per E-Mail mit Code und Druckversion zugestellt.",
        `Der Gutschein ist ${years} Jahr(e) ab Kauf gültig; das Ablaufdatum steht auf dem Gutschein. Massgebend ist das Datum der Buchung oder der Einlösung im Hotel: Wird vor dem Ablaufdatum gebucht, gilt der Gutschein auch für einen Aufenthalt nach diesem Datum.`,
        "Der Gutschein kann online bei der Buchung auf dieser Website oder im Hotel für Übernachtungen und weitere Leistungen des Hotels eingelöst werden, auch in mehreren Teilbeträgen. Ein Restwert bleibt bis zum Ablaufdatum gültig. Eine Barauszahlung ist ausgeschlossen, soweit gesetzlich zulässig.",
        "Der Gutschein ist übertragbar. Wer den Code kennt, kann ihn einlösen; bewahren Sie ihn deshalb sorgfältig auf. Für eine Einlösung durch Unberechtigte haftet das Hotel nur, wenn Sie den Verlust vorher gemeldet haben.",
        "Wird eine ganz oder teilweise mit Gutschein bezahlte Buchung storniert, richtet sich die Rückerstattung nach den Stornobedingungen (Ziffer 4) und wird im Verhältnis der Zahlungsarten aufgeteilt: Der Gutscheinanteil wird dem Gutschein wieder gutgeschrieben (Ablaufdatum unverändert), der übrige Teil auf das ursprüngliche Zahlungsmittel zurückerstattet. Läuft eine Reservierung ohne Zahlung ab, wird der Gutscheinbetrag automatisch wieder gutgeschrieben.",
        "Gekaufte Gutscheine können nicht zurückgegeben werden. Nach Schweizer Recht besteht kein gesetzliches Widerrufsrecht; zwingende Widerrufsrechte für Konsumentinnen und Konsumenten mit Wohnsitz in der EU bleiben vorbehalten.",
      ] }] : []),
      { h: `${v ? 9 : 8}. Anwendbares Recht und Gerichtsstand`, p: ["Es gilt Schweizer Recht. Gerichtsstand ist der Sitz des Hotels; zwingende Gerichtsstände für Konsumentinnen und Konsumenten bleiben vorbehalten."] },
    ],
  };
}

export function privacy(h: Hotel, l: Locale): LegalDoc {
  const p = platformInfo();
  const hotel = hotelLine(h);
  const channex = h.channexEnabled;
  // ASSUMPTION: AGB/Datenschutz gibt es nur DE und EN (juristisch geprüft werden müssen sie ohnehin); FR/IT/NL zeigen Englisch mit Hinweis.
  if (l !== "de") {
    return {
      title: "Privacy Policy",
      intro: `This privacy policy explains how personal data is processed when you use this website and book directly. It is based on the Swiss Federal Act on Data Protection (FADP) and, where applicable, the EU General Data Protection Regulation (GDPR).`,
      draftNote: "Draft – to be reviewed before use.",
      sections: [
        { h: "1. Controller", p: [`Controller for your booking data: ${hotel}, email ${h.contactEmail}${h.contactPhone ? `, phone ${h.contactPhone}` : ""}.`, `The website and booking system are operated by ${p.name} (${p.operator}, ${p.email}) as a processor on behalf of the Hotel.`] },
        { h: "2. Data we process", p: ["Requests via the contact form (groups, seminars, weddings): name, email address, phone number (optional), occasion, dates, number of guests and your message – used only to answer your request.", ...(h.content.vouchers?.enabled ? ["Gift vouchers: name and email address of the buyer, name of the recipient and dedication (optional), voucher code, value, remaining value and redemptions."] : []), "Booking data: first and last name, email address, phone number (optional), language, dates, number of guests and ages of children (for the tourist tax), selected room and rate, prices, notes.", "Payment data: Stripe processes your payment details. We only receive the payment status, amount, payment method type and a reference – no card numbers.", "Technical data: IP address and time of requests, temporarily for security purposes (e.g. protection against abuse). Guests are not tracked; the website sets no tracking or advertising cookies."] },
        { h: "3. Purposes and legal bases", p: ["Performing the booking and the stay, communication about your booking, statutory guest registration, accounting and retention obligations, security of the website.", "Under the GDPR: performance of a contract (Art. 6(1)(b)), legal obligations (Art. 6(1)(c)), legitimate interests (Art. 6(1)(f)) and, for offers by email, your consent (Art. 6(1)(a)), which you can withdraw at any time."] },
        { h: "4. Recipients", p: [
          "Stripe Payments Europe, Ltd. (Ireland) for payment processing; Stripe may also process data in the USA.",
          "Postmark (ActiveCampaign, LLC, USA) for sending booking emails.",
          `Hosting: ${p.hosting}.`,
          ...(channex ? ["Channex (channel manager) to synchronise availability with booking portals and to receive their bookings."] : []),
          "Authorities where required by law (e.g. police guest registration, tourist tax office).",
          "Where data is transferred to countries without adequate data protection, this is done on the basis of recognised safeguards (e.g. Swiss-US Data Privacy Framework or standard contractual clauses).",
        ] },
        { h: "5. Retention", p: ["Booking and accounting data are kept for 10 years (Art. 958f Swiss Code of Obligations). Guest registration data is kept for the period prescribed by cantonal law. Data for offers by email is kept until you withdraw your consent. Security logs are deleted after a short period."] },
        { h: "6. Your rights", p: [`You have the right to information, rectification, erasure, restriction, objection and data portability, and you can withdraw consent at any time. Please contact the Hotel at ${h.contactEmail}.`, "You can lodge a complaint with the Swiss Federal Data Protection and Information Commissioner (FDPIC) or, in the EU, with your local supervisory authority."] },
        { h: "7. Changes", p: [`This policy may be updated. Version: ${LEGAL_VERSION}.`] },
      ],
    };
  }
  return {
    title: "Datenschutzerklärung",
    intro: "Diese Datenschutzerklärung erklärt, wie Personendaten bearbeitet werden, wenn Sie diese Website nutzen und direkt buchen. Sie richtet sich nach dem Schweizer Datenschutzgesetz (DSG) und, soweit anwendbar, nach der EU-Datenschutz-Grundverordnung (DSGVO).",
    draftNote: "Entwurf – vor Verwendung rechtlich prüfen lassen.",
    sections: [
      { h: "1. Verantwortlicher", p: [`Verantwortlich für Ihre Buchungsdaten ist ${hotel}, E-Mail ${h.contactEmail}${h.contactPhone ? `, Telefon ${h.contactPhone}` : ""}.`, `Website und Buchungssystem betreibt ${p.name} (${p.operator}, ${p.email}) als Auftragsbearbeiter im Auftrag des Hotels.`] },
      { h: "2. Welche Daten wir bearbeiten", p: ["Anfragen über das Formular (Gruppen, Seminare, Hochzeiten): Name, E-Mail-Adresse, Telefonnummer (freiwillig), Anlass, Daten, Anzahl Personen und Ihre Nachricht – ausschliesslich zur Beantwortung Ihrer Anfrage.", ...(h.content.vouchers?.enabled ? ["Gutscheine: Name und E-Mail-Adresse der Käuferin oder des Käufers, Name der beschenkten Person und Widmung (freiwillig), Gutschein-Code, Wert, Restwert und Einlösungen."] : []), "Buchungsdaten: Vor- und Nachname, E-Mail-Adresse, Telefonnummer (freiwillig), Sprache, Reisedaten, Anzahl Personen und Alter der Kinder (für die Kurtaxe), gewähltes Zimmer und Angebot, Preise, Bemerkungen.", "Zahlungsdaten: Ihre Zahlungsangaben verarbeitet Stripe. Wir erhalten nur Zahlungsstatus, Betrag, Art der Zahlungsmethode und eine Referenz – keine Kartennummern.", "Technische Daten: IP-Adresse und Zeitpunkt von Anfragen, vorübergehend zur Sicherheit (z. B. Schutz vor Missbrauch). Gäste werden nicht getrackt; die Website setzt keine Tracking- oder Werbe-Cookies."] },
      { h: "3. Zwecke und Rechtsgrundlagen", p: ["Abwicklung der Buchung und des Aufenthalts, Kommunikation zu Ihrer Buchung, gesetzliche Gästemeldung, Buchhaltungs- und Aufbewahrungspflichten, Sicherheit der Website.", "Nach DSGVO: Vertragserfüllung (Art. 6 Abs. 1 lit. b), rechtliche Pflichten (lit. c), berechtigte Interessen (lit. f) und für Angebote per E-Mail Ihre Einwilligung (lit. a), die Sie jederzeit widerrufen können."] },
      { h: "4. Empfänger", p: [
        "Stripe Payments Europe, Ltd. (Irland) für die Zahlungsabwicklung; Stripe kann Daten auch in den USA bearbeiten.",
        "Postmark (ActiveCampaign, LLC, USA) für den Versand der Buchungs-E-Mails.",
        `Hosting: ${p.hosting}.`,
        ...(channex ? ["Channex (Channel-Manager), um die Verfügbarkeit mit Buchungsportalen abzugleichen und deren Buchungen zu übernehmen."] : []),
        "Behörden, soweit gesetzlich vorgeschrieben (z. B. polizeiliche Gästemeldung, Kurtaxen-Stelle).",
        "Werden Daten in Länder ohne angemessenen Datenschutz übermittelt, geschieht dies gestützt auf anerkannte Garantien (z. B. Swiss-US Data Privacy Framework oder Standardvertragsklauseln).",
      ] },
      { h: "5. Aufbewahrung", p: ["Buchungs- und Buchhaltungsdaten werden 10 Jahre aufbewahrt (Art. 958f OR). Meldedaten der Gästeregistrierung so lange, wie es das kantonale Recht vorschreibt. Daten für Angebote per E-Mail bis zum Widerruf Ihrer Einwilligung. Sicherheitsprotokolle werden nach kurzer Zeit gelöscht."] },
      { h: "6. Ihre Rechte", p: [`Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch und Datenherausgabe und können Einwilligungen jederzeit widerrufen. Wenden Sie sich dafür an das Hotel: ${h.contactEmail}.`, "Sie können sich beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) oder, in der EU, bei Ihrer Aufsichtsbehörde beschweren."] },
      { h: "7. Änderungen", p: [`Diese Datenschutzerklärung kann angepasst werden. Stand: ${LEGAL_VERSION}.`] },
    ],
  };
}
