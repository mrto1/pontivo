/**
 * Google (SPEC 19.67). Reine Logik ohne I/O: Herkunft «google», Links für das Google-Unternehmensprofil,
 * Buchungslink mit den Platzhaltern von Channex für kostenlose Buchungslinks, Prüfliste und Feeds für das Actions Center.
 */

/** Erlaubte Herkunftsangaben in der Adresse (`?ref=`) */
export const REFERRERS = ["google"] as const;
export type Referrer = (typeof REFERRERS)[number];
export const parseReferrer = (v: unknown): Referrer | null => (typeof v === "string" && (REFERRERS as readonly string[]).includes(v) ? (v as Referrer) : null);

export type GoogleLinks = { website: string; book: string | null; bookTemplate: string | null; reserve: string | null; order: string | null };

/**
 * Links für das Google-Unternehmensprofil. `base` = öffentliche Adresse des Betriebs (publicBase), `lang` = Hauptsprache.
 * `bookTemplate`: Buchungslink mit den Platzhaltern, die Channex beim Klick aus Google ersetzt (docs.channex.io/google/google-hotel-ads, Step 2).
 */
export function googleLinks(o: { base: string; lang: string; lodging: boolean; reserve: boolean; order: boolean }): GoogleLinks {
  const b = `${o.base}/${o.lang}`;
  return {
    website: `${b}`,
    book: o.lodging ? `${b}/book?ref=google` : null,
    bookTemplate: o.lodging ? `${b}/book?checkin=(CHECKIN_DATE)&checkout=(CHECKOUT_DATE)&adults=(ADULTS)&ref=google` : null,
    reserve: o.reserve ? `${b}/tisch?ref=google` : null,
    order: o.order ? `${b}/bestellen?ref=google` : null,
  };
}

export type ListingInput = {
  address: boolean; phone: boolean; coordinates: boolean; photo: boolean; description: boolean; cancellation: boolean; live: boolean; channex: boolean;
};
export type CheckItem = { key: keyof ListingInput; ok: boolean; text: string; where: string };

/** Was Google für kostenlose Buchungslinks über Channex braucht (Inhalte der Property, docs.channex.io «Content requirements») */
export function listingChecklist(i: ListingInput): CheckItem[] {
  return [
    { key: "live", ok: i.live, text: "Online-Buchung ist live", where: "site" },
    { key: "address", ok: i.address, text: "Adresse vollständig (Strasse, PLZ, Ort), genau wie im Google-Unternehmensprofil", where: "settings" },
    { key: "phone", ok: i.phone, text: "Telefonnummer", where: "settings" },
    { key: "coordinates", ok: i.coordinates, text: "Lage auf der Karte (Baustein «Lage» mit Koordinaten)", where: "site" },
    { key: "photo", ok: i.photo, text: "Mindestens ein Foto", where: "site" },
    { key: "description", ok: i.description, text: "Beschreibung des Hauses (Startseite)", where: "site" },
    { key: "cancellation", ok: i.cancellation, text: "Tarife mit Stornoregel", where: "rooms" },
    { key: "channex", ok: i.channex, text: "Channel-Manager verbunden (Zimmer und Preise gehen über Channex an Google)", where: "channex" },
  ];
}

// ---------------------------------------------------------------- Actions Center (Restaurants)
// Feeds nach developers.google.com/actions-center/verticals/reservations/redirect/reference/feeds (Entity, Action, Descriptor).

export type FeedEntity = {
  id: string; name: string; phone: string | null; url: string;
  lat: number | null; lng: number | null; street: string; city: string; postalCode: string; country: "CH";
  reserveUrl: string | null; orderUrl: string | null; delivery: boolean; takeout: boolean;
};

/** Entity-Feed: ein Eintrag je Betrieb (entity_id bleibt immer gleich: die ID des Betriebs) */
export function entityFeed(list: FeedEntity[]) {
  return {
    data: list.map((e) => ({
      entity_id: e.id,
      name: e.name,
      ...(e.phone ? { telephone: e.phone } : {}),
      url: e.url,
      location: {
        ...(e.lat !== null && e.lng !== null ? { latitude: e.lat, longitude: e.lng } : {}),
        // ASSUMPTION: strukturierte Adresse im Feld `address` (Beispiele der Actions-Center-Doku), Land als ISO-Code
        address: { street_address: e.street, locality: e.city, postal_code: e.postalCode, country: e.country },
      },
    })),
  };
}

/** Action-Feed: Tisch reservieren (TABLE_RESERVATION) und Bestellen (food_ordering_info DELIVERY/TAKEOUT), je ein Link */
export function actionFeed(list: FeedEntity[]) {
  const data: { entity_id: string; link_id: string; url: string; actions: Record<string, unknown>[] }[] = [];
  for (const e of list) {
    if (e.reserveUrl) data.push({ entity_id: e.id, link_id: `${e.id}-reserve`, url: e.reserveUrl, actions: [{ dining_info: { dining_type: "TABLE_RESERVATION" } }] });
    if (e.orderUrl && (e.delivery || e.takeout)) {
      const kinds = [...(e.delivery ? ["DELIVERY"] : []), ...(e.takeout ? ["TAKEOUT"] : [])];
      data.push({ entity_id: e.id, link_id: `${e.id}-order`, url: e.orderUrl, actions: kinds.map((k) => ({ food_ordering_info: { service_type: k } })) });
    }
  }
  return { data };
}

/** Beschreibung eines Feed-Uploads (fileset descriptor) */
export const feedDescriptor = (name: "reservewithgoogle.entity" | "reservewithgoogle.action.v2", ts: number, files: string[]) => ({ generation_timestamp: ts, name, data_file: files });
