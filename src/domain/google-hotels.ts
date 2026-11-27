/**
 * Google Hotelpreise als eigener Connectivity-Partner (SPEC 19.70). Reine Logik ohne I/O:
 * Hotelliste (listings), Landingpage-Datei, ARI-Nachrichten (Property Data, Rate, Inventory, Availability, TaxFeeInfo)
 * und die Auswertung der Antworten. Schreibweise nach developers.google.com/hotels/hotel-prices (xml-reference).
 *
 * Zuordnung: Hotel-ID = hotels.id, RoomID = room_types.id, PackageID/RatePlanCode = rate_plans.id.
 * Geld in Rappen im Modell, in der Nachricht als Dezimalzahl in CHF.
 */
import { createHash } from "node:crypto";
import { addDays, nightsOf, weekday, type Day } from "./dates";
import { rappenToDecimal } from "./money";
import { priceForNight, type PlanPricing } from "./pricing";
import type { TaxRule } from "./tourist-tax";

/** Wohin Google die ARI-Nachrichten gesendet werden (HTTP POST, Content-Type application/xml, Host www.google.com) */
export const GOOGLE_PATHS = {
  property: "/travel/hotels/uploads/property_data",
  rate: "/travel/hotels/uploads/ota/hotel_rate_amount_notif",
  inventory: "/travel/hotels/uploads/ota/hotel_inv_count_notif",
  availability: "/travel/hotels/uploads/ota/hotel_avail_notif",
  taxes: "/travel/hotels/uploads/taxes",
} as const;
export type GoogleKind = keyof typeof GOOGLE_PATHS;

/** So weit in die Zukunft sendet Pontivo Preise und Bestand (Google empfiehlt mindestens das kommende Jahr) */
export const GOOGLE_ARI_DAYS = 365;
export const OTA_NS = "http://www.opentravel.org/OTA/2003/05";

export const xmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** EchoToken und Nachrichten-ID: erlaubt sind a-z, A-Z, 0-9, _ und - */
export const messageId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
export const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export type Meta = { ts: Date; id: string; partner: string };
const HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n`;

// ---------------------------------------------------------------- Hotelliste

export type ListingHotel = {
  id: string; name: string; street: string; city: string; postalCode: string; canton: string;
  country: "CH"; lat: number; lng: number; phone: string | null; category: string;
};

/** Hotelliste (listings): Pflicht sind ID, Name, Adresse mit Strasse, Ort, Region (Kanton) und PLZ, Land, Koordinaten */
export function hotelListFeed(list: ListingHotel[], lang = "de"): string {
  const items = list.map((h) => `  <listing>
    <id>${xmlText(h.id)}</id>
    <name>${xmlText(h.name)}</name>
    <address format="simple">
      <component name="addr1">${xmlText(h.street)}</component>
      <component name="city">${xmlText(h.city)}</component>
      <component name="province">${xmlText(h.canton)}</component>
      <component name="postal_code">${xmlText(h.postalCode)}</component>
    </address>
    <country>${h.country}</country>
    <latitude>${h.lat}</latitude>
    <longitude>${h.lng}</longitude>${h.phone ? `\n    <phone type="main">${xmlText(h.phone)}</phone>` : ""}
    <category>${xmlText(h.category)}</category>
  </listing>`).join("\n");
  return `${HEAD}<listings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.gstatic.com/localfeed/local_feed.xsd">\n  <language>${xmlText(lang)}</language>\n${items}\n</listings>\n`;
}

// ---------------------------------------------------------------- Landingpage

/** Eine Landingpage für alle Betriebe: die Plattform leitet nach Hotel-ID sofort auf die Buchungsseite des Betriebs weiter. */
export function landingPagesFile(platformBase: string): string {
  const q = [
    "checkin=(CHECKINYEAR)-(CHECKINMONTH)-(CHECKINDAY)",
    "checkout=(CHECKOUTYEAR)-(CHECKOUTMONTH)-(CHECKOUTDAY)",
    "adults=(NUM-ADULTS)",
    "children=(NUM-CHILDREN)(FOR-EACH-CHILD-AGE)&amp;age=(CHILD-AGE)(END-FOR-EACH)",
    "lang=(USER-LANGUAGE)",
  ].join("&amp;");
  return `${HEAD}<PointsOfSale>\n  <PointOfSale id="pontivo">\n    <URL>${xmlText(platformBase).replace(/\/$/, "")}/g/(PARTNER-HOTEL-ID)?${q}</URL>\n  </PointOfSale>\n</PointsOfSale>\n`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const LANDING_LANGS = ["de", "en", "fr", "it", "nl"] as const;

/** Weiterleitung von der Landingpage auf die Buchungsseite des Betriebs (Parameter wie von Google gesetzt, ungültige werden weggelassen) */
export function landingTarget(o: { base: string; defaultLang: string; params: URLSearchParams }): string {
  const p = o.params;
  const lang = (LANDING_LANGS as readonly string[]).includes(p.get("lang") ?? "") ? p.get("lang")! : o.defaultLang;
  const q = new URLSearchParams();
  const ci = p.get("checkin") ?? "", co = p.get("checkout") ?? "";
  if (DAY.test(ci) && DAY.test(co) && ci < co) {
    q.set("checkin", ci);
    q.set("checkout", co);
    const adults = Number(p.get("adults"));
    q.set("adults", String(Number.isInteger(adults) && adults >= 1 && adults <= 10 ? adults : 2));
    const ages = p.getAll("age").map(Number).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, 10);
    const children = Number(p.get("children"));
    const n = ages.length || (Number.isInteger(children) && children >= 0 && children <= 10 ? children : 0);
    q.set("children", String(n));
    if (ages.length) q.set("ages", ages.join(","));
  }
  q.set("ref", "google");
  return `${o.base.replace(/\/$/, "")}/${lang}/book?${q.toString()}`;
}

// ---------------------------------------------------------------- Zimmer, Tarife (Property Data)

export type RoomModel = { id: string; name: string; description: string; photos: { url: string; alt?: string }[]; maxOccupancy: number; maxAdults: number; maxChildren: number; planIds: string[] };
export type PlanModel = {
  id: string; name: string; description: string;
  /** Freie Stornierung: Stunden vor Anreise (null = nicht stornierbar) */
  freeCancelHours: number | null; checkinTime: string; breakfast: boolean; dinner: boolean;
};

const text = (tag: string, s: string, lang: string) => `<${tag}><Text text="${xmlText(s)}" language="${xmlText(lang)}"/></${tag}>`;

/** Tage bis zur Anreise, bis zu denen kostenlos storniert werden kann: aufgerundet, Google erhält nie ein grosszügigeres Versprechen als der Betrieb gibt */
export const refundableDays = (hours: number | null): number | null => (hours === null ? null : Math.min(330, Math.ceil(hours / 24)));

export function propertyDataMessage(m: Meta, hotelId: string, rooms: RoomModel[], plans: PlanModel[], lang: string): string {
  const roomXml = rooms.map((r) => `    <RoomData>
      <RoomID>${xmlText(r.id)}</RoomID>
      ${text("Name", r.name, lang)}
      ${text("Description", r.description || r.name, lang)}
      <AllowablePackageIDs>${r.planIds.map((p) => `<AllowablePackageID>${xmlText(p)}</AllowablePackageID>`).join("")}</AllowablePackageIDs>${r.photos.slice(0, 10).map((p) => `
      <PhotoURL><URL>${xmlText(p.url)}</URL>${p.alt ? `<Caption><Text text="${xmlText(p.alt)}" language="${xmlText(lang)}"/></Caption>` : ""}</PhotoURL>`).join("")}
      <Capacity>${Math.min(99, Math.max(1, r.maxOccupancy))}</Capacity>
      <AdultCapacity>${Math.min(99, Math.max(1, r.maxAdults))}</AdultCapacity>${r.maxChildren > 0 ? `\n      <ChildCapacity>${Math.min(99, r.maxChildren)}</ChildCapacity>` : ""}
    </RoomData>`).join("\n");
  const planXml = plans.map((p) => {
    const days = refundableDays(p.freeCancelHours);
    return `    <PackageData>
      <PackageID>${xmlText(p.id)}</PackageID>
      ${text("Name", p.name, lang)}
      ${text("Description", p.description || p.name, lang)}
      <Refundable available="${days !== null}"${days !== null ? ` refundable_until_days="${days}" refundable_until_time="${xmlText(p.checkinTime.length === 5 ? `${p.checkinTime}:00` : p.checkinTime)}"` : ""}/>
      <BreakfastIncluded>${p.breakfast}</BreakfastIncluded>${p.dinner ? `\n      <Meals><Breakfast included="${p.breakfast}"/><Dinner included="true"/></Meals>` : ""}
    </PackageData>`;
  }).join("\n");
  return `${HEAD}<Transaction timestamp="${m.ts.toISOString()}" id="${messageId(m.id)}" partner="${xmlText(m.partner)}">
  <PropertyDataSet action="overlay">
    <Property>${xmlText(hotelId)}</Property>
${roomXml}
${planXml}
  </PropertyDataSet>
</Transaction>
`;
}

// ---------------------------------------------------------------- Tage zu Bereichen

export type Run<T> = { from: Day; to: Day; value: T };

/** Tage mit gleichem Wert zu Bereichen zusammenfassen (to inklusive); Tage ohne Wert (undefined) unterbrechen */
export function groupRuns<T>(days: Day[], valueOf: (d: Day) => T | undefined): Run<T>[] {
  const out: Run<T>[] = [];
  for (const d of days) {
    const v = valueOf(d);
    if (v === undefined) continue;
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === d && JSON.stringify(last.value) === JSON.stringify(v)) last.to = d;
    else out.push({ from: d, to: d, value: v });
  }
  return out;
}

export const rangeDays = (from: Day, days: number): Day[] => nightsOf(from, addDays(from, days));

// ---------------------------------------------------------------- Preise (OTA_HotelRateAmountNotifRQ)

export type RateValue = { prices: { guests: number; rappen: number }[] };
export type RateDay = { night: Day; priceRappen: number };

/** Preise je Anzahl Erwachsener (1 … maxAdults), gleiche Rechnung wie auf der Buchungsseite; Kinder erhöhen den Preis nicht */
export function rateRuns(rows: RateDay[], plan: PlanPricing, maxAdults: number, days: Day[]): Run<RateValue>[] {
  const by = new Map(rows.map((r) => [r.night, r.priceRappen]));
  return groupRuns(days, (d) => {
    const base = by.get(d);
    if (base === undefined) return undefined;
    return { prices: Array.from({ length: Math.max(1, maxAdults) }, (_, i) => ({ guests: i + 1, rappen: priceForNight(base, plan, i + 1, 0) })) };
  });
}

type Product = { roomId: string; planId: string };

/**
 * `taxSeparate`: Kurtaxe kommt zusätzlich (TaxFeeInfo), der Betrag ist dann «vor Steuern»;
 * sonst ist alles im Preis enthalten und der Betrag gilt «nach Steuern».
 */
export function rateMessage(m: Meta, hotelId: string, items: (Product & { runs: Run<RateValue>[] })[], currency: string, taxSeparate: boolean): string {
  const attr = taxSeparate ? "AmountBeforeTax" : "AmountAfterTax";
  const msgs = items.flatMap((it) => it.runs.map((r) => `    <RateAmountMessage>
      <StatusApplicationControl Start="${r.from}" End="${r.to}" InvTypeCode="${xmlText(it.roomId)}" RatePlanCode="${xmlText(it.planId)}"/>
      <Rates>
        <Rate>
          <BaseByGuestAmts>${r.value.prices.map((p) => `<BaseByGuestAmt ${attr}="${rappenToDecimal(p.rappen)}" CurrencyCode="${currency}" NumberOfGuests="${p.guests}"/>`).join("")}</BaseByGuestAmts>
          <AdditionalGuestAmounts><AdditionalGuestAmount AgeQualifyingCode="8" MaxAge="17" Amount="0.00"/></AdditionalGuestAmounts>
        </Rate>
      </Rates>
    </RateAmountMessage>`));
  return `${HEAD}<OTA_HotelRateAmountNotifRQ xmlns="${OTA_NS}" EchoToken="${messageId(m.id)}" TimeStamp="${m.ts.toISOString()}" Version="3.0" NotifType="Overlay" NotifScopeType="ProductRate">
  <POS><Source><RequestorID ID="${xmlText(m.partner)}"/></Source></POS>
  <RateAmountMessages HotelCode="${xmlText(hotelId)}">
${msgs.join("\n")}
  </RateAmountMessages>
</OTA_HotelRateAmountNotifRQ>
`;
}

// ---------------------------------------------------------------- Bestand (OTA_HotelInvCountNotifRQ)

export type InvDay = { night: Day; total: number; booked: number; blocked: number; externalBlocked: number };

/** Freie Einheiten je Nacht (wie auf der Buchungsseite und bei Channex); fehlende Tage = 0, inaktiver Zimmertyp = 0 */
export function inventoryRuns(rows: InvDay[], active: boolean, days: Day[]): Run<number>[] {
  const by = new Map(rows.map((r) => [r.night, active ? Math.max(0, r.total - r.booked - r.blocked - r.externalBlocked) : 0]));
  return groupRuns(days, (d) => by.get(d) ?? 0);
}

export function inventoryMessage(m: Meta, hotelId: string, items: { roomId: string; runs: Run<number>[] }[]): string {
  const msgs = items.flatMap((it) => it.runs.map((r) => `    <Inventory>
      <StatusApplicationControl Start="${r.from}" End="${r.to}" InvTypeCode="${xmlText(it.roomId)}"/>
      <InvCounts><InvCount Count="${r.value}" CountType="2"/></InvCounts>
    </Inventory>`));
  return `${HEAD}<OTA_HotelInvCountNotifRQ xmlns="${OTA_NS}" EchoToken="${messageId(m.id)}" TimeStamp="${m.ts.toISOString()}" Version="3.0">
  <POS><Source><RequestorID ID="${xmlText(m.partner)}"/></Source></POS>
  <Inventories HotelCode="${xmlText(hotelId)}">
${msgs.join("\n")}
  </Inventories>
</OTA_HotelInvCountNotifRQ>
`;
}

// ---------------------------------------------------------------- Einschränkungen (OTA_HotelAvailNotifRQ)

export type AvailValue = { stopSell: boolean; cta: boolean; ctd: boolean; minStay: number; maxStay: number };
export type AvailDay = { night: Day; minStayArrival: number; maxStay: number | null; closedToArrival: boolean; closedToDeparture: boolean; stopSell: boolean };

/**
 * Einschränkungen je Nacht. Wie bei Channex: Mindestaufenthalt = max(Tag, Tarif), fester Anreisetag sperrt die übrigen Tage,
 * inaktiver Tarif und fehlende Zeile = geschlossen. maxStay 0 = keine Begrenzung.
 */
export function availRuns(rows: AvailDay[], plan: { minNights: number; arrivalWeekdays: number[]; active: boolean }, days: Day[]): Run<AvailValue>[] {
  const by = new Map(rows.map((r) => [r.night, r]));
  return groupRuns(days, (d) => {
    const r = by.get(d);
    if (!r) return { stopSell: true, cta: false, ctd: false, minStay: 1, maxStay: 0 };
    return {
      stopSell: r.stopSell || !plan.active,
      cta: r.closedToArrival || (plan.arrivalWeekdays.length > 0 && !plan.arrivalWeekdays.includes(weekday(d))),
      ctd: r.closedToDeparture,
      minStay: Math.max(r.minStayArrival, plan.minNights),
      maxStay: r.maxStay ?? 0,
    };
  });
}

export function availabilityMessage(m: Meta, hotelId: string, items: (Product & { runs: Run<AvailValue>[] })[]): string {
  const msgs = items.flatMap((it) => it.runs.flatMap((r) => {
    const sac = `<StatusApplicationControl Start="${r.from}" End="${r.to}" InvTypeCode="${xmlText(it.roomId)}" RatePlanCode="${xmlText(it.planId)}"/>`;
    const restr = (restriction: string, closed: boolean) => `    <AvailStatusMessage>\n      ${sac}\n      <RestrictionStatus Status="${closed ? "Close" : "Open"}" Restriction="${restriction}"/>\n    </AvailStatusMessage>`;
    const los = (type: string, n: number) => `    <AvailStatusMessage>\n      ${sac}\n      <LengthsOfStay><LengthOfStay Time="${n}" TimeUnit="Day" MinMaxMessageType="${type}"/></LengthsOfStay>\n    </AvailStatusMessage>`;
    return [restr("Master", r.value.stopSell), restr("Arrival", r.value.cta), restr("Departure", r.value.ctd), los("SetMinLOS", r.value.minStay), los("SetMaxLOS", r.value.maxStay)];
  }));
  return `${HEAD}<OTA_HotelAvailNotifRQ xmlns="${OTA_NS}" EchoToken="${messageId(m.id)}" TimeStamp="${m.ts.toISOString()}" Version="3.0">
  <POS><Source><RequestorID ID="${xmlText(m.partner)}"/></Source></POS>
  <AvailStatusMessages HotelCode="${xmlText(hotelId)}">
${msgs.join("\n")}
  </AvailStatusMessages>
</OTA_HotelAvailNotifRQ>
`;
}

// ---------------------------------------------------------------- Kurtaxe (TaxFeeInfo)

/** Ob die Kurtaxe zum Preis dazukommt und darum an Google gemeldet werden muss */
export const taxSeparate = (rule: TaxRule | null, includedInPrice: boolean): boolean =>
  !includedInPrice && !!rule && rule.status !== "none" && (rule.adultRappen ?? 0) > 0;

/** Altersstufen der Kinder (0 … 17) aus der Kurtaxe-Regel: gleiche Sätze wie `ratePerPerson` */
export function childBrackets(rule: TaxRule): { maxAge: number; rappen: number }[] {
  const adult = rule.adultRappen ?? 0;
  const out: { maxAge: number; rappen: number }[] = [];
  for (let age = 0; age <= 17; age++) {
    const rappen = age < rule.freeUnderAge ? 0 : rule.reducedUnderAge !== null && rule.reducedRappen !== null && age < rule.reducedUnderAge ? rule.reducedRappen : adult;
    const last = out[out.length - 1];
    if (last && last.rappen === rappen) last.maxAge = age;
    else out.push({ maxAge: age, rappen });
  }
  return out;
}

/** Kurtaxe je Person und Nacht als Steuer; ohne getrennte Kurtaxe eine leere Property (löscht frühere Angaben, Overlay) */
export function taxFeeMessage(m: Meta, hotelId: string, rule: TaxRule | null, includedInPrice: boolean, currency: string): string {
  const taxes = rule && taxSeparate(rule, includedInPrice)
    ? `
    <Taxes>
      <Tax>
        <Type>amount</Type>
        <Basis>person</Basis>
        <Period>night</Period>
        <Currency>${currency}</Currency>
        <AgeBrackets>
          <AdultCharge amount="${rappenToDecimal(rule.adultRappen ?? 0)}"/>
          <ChildAgeBrackets>${childBrackets(rule).map((b) => `<ChildAgeBracket max_age="${b.maxAge}" amount="${rappenToDecimal(b.rappen)}"/>`).join("")}</ChildAgeBrackets>
        </AgeBrackets>
        <Rank>1</Rank>
      </Tax>
    </Taxes>`
    : "";
  return `${HEAD}<TaxFeeInfo timestamp="${m.ts.toISOString()}" id="${messageId(m.id)}" partner="${xmlText(m.partner)}">
  <Property action="overlay">
    <ID>${xmlText(hotelId)}</ID>${taxes}
  </Property>
</TaxFeeInfo>
`;
}

// ---------------------------------------------------------------- Antworten

export type GoogleReply = { ok: boolean; warnings: string[]; errors: string[] };

/**
 * Antwort von Google auswerten. OTA-Nachrichten: `<Success/>` oder `<Errors><Error ShortText="…"/></Errors>`;
 * Transaction/TaxFeeInfo: `<Success/>` oder `<Issues><Issue code status>`; Warnungen (status warning) sind kein Fehler.
 */
export function parseReply(xml: string): GoogleReply {
  const errors: string[] = [], warnings: string[] = [];
  for (const m of xml.matchAll(/<Error\b[^>]*?ShortText="([^"]*)"/g)) errors.push(m[1]!);
  for (const m of xml.matchAll(/<Issue\b([^>]*)>([^<]*)/g)) {
    const attrs = m[1]!;
    const status = /status="([^"]*)"/.exec(attrs)?.[1] ?? "error";
    const code = /code="([^"]*)"/.exec(attrs)?.[1] ?? "?";
    const msg = `${code}${m[2]!.trim() ? `: ${m[2]!.trim()}` : ""}`;
    (status === "warning" ? warnings : errors).push(msg);
  }
  const success = /<Success\b/.test(xml);
  return { ok: success && errors.length === 0, warnings, errors: !success && errors.length === 0 ? ["Antwort ohne Success"] : errors };
}
