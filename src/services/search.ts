import type { Locale } from "../i18n/dict";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, type Executor } from "../db/client";
import { extras, inventoryDays, ratePlans, ratesDays, roomTypes, type Hotel, type RatePlan, type RoomType } from "../db/schema";
import { resolveExtras } from "../domain/extras";
import { tr } from "../domain/blocks";
import { addDays, nightsOf, todayIn, weekday, type Day } from "../domain/dates";
import { evaluateOffer, validateStay, type Rejection, type StayQuery } from "../domain/availability";
import { grandTotal, priceStay, type NightlyPrice } from "../domain/pricing";
import { computeTouristTax, needsChildAges, TouristTaxUnconfirmedError } from "../domain/tourist-tax";
import { cancellationPolicyText } from "../domain/cancellation";
import { taxRuleFor } from "./hotels";
import { planName, roomDescription, roomName } from "../domain/i18n-names";
import { splitGuests } from "../domain/multiroom";
import { applyDiscount, bestAdjustment, fillsGap, gapSettings, type Adjustment } from "../domain/direct-tools";

export type SearchInput = StayQuery & { childrenAges?: (number | null)[]; /** Anzahl gleicher Zimmer (SPEC 19.6), Standard 1; Personen werden gleichmässig verteilt */ rooms?: number };

export type Offer = {
  roomType: Pick<RoomType, "id" | "name" | "description" | "photos" | "maxOccupancy">;
  ratePlan: Pick<RatePlan, "id" | "name" | "breakfastIncluded" | "board" | "freeCancelHours" | "cancelFeeBps">;
  nightlyPrices: NightlyPrice[];
  roomsTotalRappen: number;
  touristTaxRappen: number;
  touristTaxIncluded: boolean;
  /** obligatorische Zusatzleistungen (z. B. Endreinigung), im total enthalten */
  extrasRappen: number;
  mandatoryExtras: { name: string; amountRappen: number }[];
  totalRappen: number;
  cancellationPolicy: string;
  /** Rabatt (Firmencode oder Lückenfüller, SPEC 19.29), steckt schon in den Nachtpreisen; `discountRappen` ist die Ersparnis gegenüber dem normalen Preis */
  adjustment: Adjustment | null;
  discountRappen: number;
};

export type SearchResult =
  | { ok: true; offers: Offer[]; rejected: { roomTypeId: string; ratePlanId: string; reason: Rejection }[]; needsChildAges: boolean }
  | { ok: false; error: Rejection | "tourist_tax_unconfirmed" | "child_ages_required" };

/**
 * SPEC 5.1 + 5.2. Preise werden immer hier (serverseitig) berechnet.
 * Optional auf einen Zimmertyp/Rateplan eingeschränkt (für die Buchung).
 */
export async function searchOffers(
  hotel: Hotel,
  input: SearchInput,
  opts: { lang?: Locale; roomTypeId?: string; ratePlanId?: string; now?: Date; ex?: Executor; needRooms?: number; /** Rabatt eines gültigen Firmencodes in Basispunkten */ companyDiscountBps?: number } = {},
): Promise<SearchResult> {
  if ((input.rooms ?? 1) > 1) return searchMultiRoom(hotel, input, opts);
  const ex = opts.ex ?? db();
  const lang = opts.lang ?? "de";
  const today = todayIn(hotel.timezone, opts.now);
  const invalid = validateStay(input, today);
  if (invalid) return { ok: false, error: invalid };

  const rule = await taxRuleFor(hotel, input.checkin, ex);
  const ageRequired = needsChildAges(rule);
  const ages: (number | null)[] = Array.from({ length: input.children }, (_, i) => input.childrenAges?.[i] ?? null);
  if (ageRequired && input.children > 0 && ages.some((a) => a === null)) {
    return { ok: false, error: "child_ages_required" };
  }
  const nights = nightsOf(input.checkin, input.checkout);
  let touristTax: number;
  try {
    touristTax = computeTouristTax(rule, { adults: input.adults, childrenAges: ages, nights: nights.length });
  } catch (e) {
    if (e instanceof TouristTaxUnconfirmedError) return { ok: false, error: "tourist_tax_unconfirmed" };
    throw e;
  }

  const rtWhere = [eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)];
  if (opts.roomTypeId) rtWhere.push(eq(roomTypes.id, opts.roomTypeId));
  // Ankunftsinfos (Codes) gehören nie in Suchergebnisse
  const rts = (await ex.select().from(roomTypes).where(and(...rtWhere)).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name))).map((r) => ({ ...r, arrivalInfo: null }));
  if (rts.length === 0) return { ok: true, offers: [], rejected: [], needsChildAges: ageRequired };

  const rpWhere = [eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true), inArray(ratePlans.roomTypeId, rts.map((r) => r.id))];
  if (opts.ratePlanId) rpWhere.push(eq(ratePlans.id, opts.ratePlanId));
  const rps = await ex.select().from(ratePlans).where(and(...rpWhere)).orderBy(asc(ratePlans.createdAt));

  const inv = await ex
    .select()
    .from(inventoryDays)
    .where(
      and(
        eq(inventoryDays.hotelId, hotel.id),
        inArray(inventoryDays.roomTypeId, rts.map((r) => r.id)),
        // eine Nacht davor und die Abreisenacht dazu: der Lückenfüller muss die Nachbarnächte kennen
        gte(inventoryDays.night, addDays(input.checkin, -1)),
        lte(inventoryDays.night, input.checkout),
      ),
    );
  const rates = rps.length
    ? await ex
        .select()
        .from(ratesDays)
        .where(
          and(
            eq(ratesDays.hotelId, hotel.id),
            inArray(ratesDays.ratePlanId, rps.map((r) => r.id)),
            gte(ratesDays.night, input.checkin),
            lte(ratesDays.night, input.checkout as Day),
          ),
        )
    : [];

  const extraDefs = await ex.select().from(extras).where(and(eq(extras.hotelId, hotel.id), eq(extras.active, true), eq(extras.mandatory, true))).orderBy(asc(extras.sortOrder), asc(extras.createdAt));
  const persons = input.adults + input.children;

  const gaps = gapSettings(hotel.content.direct);
  const companyAdj: Adjustment | null = opts.companyDiscountBps && opts.companyDiscountBps > 0 ? { kind: "company", bps: opts.companyDiscountBps } : null;
  const offers: Offer[] = [];
  const rejected: { roomTypeId: string; ratePlanId: string; reason: Rejection }[] = [];
  for (const rt of rts) {
    const rtInv = inv.filter((i) => i.roomTypeId === rt.id);
    // Lückenfüller: füllt dieser Aufenthalt eine kurze Lücke genau?
    const inGap = gaps.enabled && fillsGap(rtInv.map((i) => ({ night: i.night, free: i.total - i.booked - i.blocked - i.externalBlocked })), input.checkin, input.checkout, gaps.maxNights);
    const gapAdj: Adjustment | null = inGap && gaps.discountBps > 0 ? { kind: "gap", bps: gaps.discountBps } : null;
    const adjustment = bestAdjustment([companyAdj, gapAdj]);
    const ignoreMinStay = inGap && gaps.relaxMinStay;
    for (const rp of rps.filter((p) => p.roomTypeId === rt.id)) {
      // fester Anreisetag (z. B. nur Samstag)
      if (rp.arrivalWeekdays.length && !rp.arrivalWeekdays.includes(weekday(input.checkin))) {
        rejected.push({ roomTypeId: rt.id, ratePlanId: rp.id, reason: "closed_to_arrival" });
        continue;
      }
      if (!ignoreMinStay && nights.length < rp.minNights) {
        rejected.push({ roomTypeId: rt.id, ratePlanId: rp.id, reason: "min_stay" });
        continue;
      }
      const res = evaluateOffer(input, rt, rtInv, rates.filter((r) => r.ratePlanId === rp.id), opts.needRooms ?? 1, ignoreMinStay);
      if (!res.ok) {
        rejected.push({ roomTypeId: rt.id, ratePlanId: rp.id, reason: res.reason });
        continue;
      }
      const full = priceStay(res.rates, rp, input.adults, input.children);
      const priced = adjustment
        ? (() => { const nightly = full.nightly.map((n) => ({ night: n.night, price_rappen: applyDiscount(n.price_rappen, adjustment.bps) })); return { nightly, roomsTotalRappen: nightly.reduce((s, n) => s + n.price_rappen, 0) }; })()
        : full;
      const mand = resolveExtras(extraDefs, [], { roomTypeId: rt.id, nights: nights.length, persons });
      offers.push({
        roomType: { id: rt.id, name: roomName(rt, lang), description: roomDescription(rt, lang), photos: rt.photos, maxOccupancy: rt.maxOccupancy },
        ratePlan: {
          id: rp.id,
          name: planName(rp, lang),
          breakfastIncluded: rp.breakfastIncluded,
          board: rp.board,
          freeCancelHours: rp.freeCancelHours,
          cancelFeeBps: rp.cancelFeeBps,
        },
        nightlyPrices: priced.nightly,
        roomsTotalRappen: priced.roomsTotalRappen,
        touristTaxRappen: touristTax,
        touristTaxIncluded: hotel.touristTaxIncludedInPrice,
        extrasRappen: mand.totalRappen,
        mandatoryExtras: mand.lines.map((l) => ({ name: tr(l.extra.name, lang), amountRappen: l.amountRappen })),
        totalRappen: grandTotal(priced.roomsTotalRappen, touristTax, hotel.touristTaxIncludedInPrice) + mand.totalRappen,
        cancellationPolicy: cancellationPolicyText(rp, lang),
        adjustment,
        discountRappen: full.roomsTotalRappen - priced.roomsTotalRappen,
      });
    }
  }
  return { ok: true, offers, rejected, needsChildAges: ageRequired };
}

/**
 * Mehrere gleiche Zimmer (SPEC 19.6): Personen verteilen, je Zimmer wie bei einem Zimmer suchen und zusammenzählen.
 * Ein Angebot erscheint nur, wenn für alle Zimmer genug frei ist und die Personen in jedes Zimmer passen.
 */
async function searchMultiRoom(hotel: Hotel, input: SearchInput, opts: Parameters<typeof searchOffers>[2] = {}): Promise<SearchResult> {
  const n = input.rooms ?? 1;
  const ages: (number | null)[] = Array.from({ length: input.children }, (_, i) => input.childrenAges?.[i] ?? null);
  const split = splitGuests(input.adults, input.children, ages, n);
  if (!split) return { ok: false, error: "occupancy" };
  const results: SearchResult[] = [];
  for (const g of split) {
    results.push(await searchOffers(hotel, { checkin: input.checkin, checkout: input.checkout, adults: g.adults, children: g.children, childrenAges: g.childrenAges, rooms: 1 }, { ...opts, needRooms: n }));
  }
  const bad = results.find((r) => !r.ok);
  if (bad && !bad.ok) return bad;
  const ok = results as Extract<SearchResult, { ok: true }>[];
  const offers: Offer[] = [];
  for (const first of ok[0].offers) {
    const parts = ok.map((r) => r.offers.find((o) => o.ratePlan.id === first.ratePlan.id));
    if (parts.some((p) => !p)) continue;
    const ps = parts as Offer[];
    const nightly = first.nightlyPrices.map((np, i) => ({ night: np.night, price_rappen: ps.reduce((a, p) => a + p.nightlyPrices[i].price_rappen, 0) }));
    offers.push({
      ...first,
      nightlyPrices: nightly,
      roomsTotalRappen: ps.reduce((a, p) => a + p.roomsTotalRappen, 0),
      touristTaxRappen: ps.reduce((a, p) => a + p.touristTaxRappen, 0),
      extrasRappen: ps.reduce((a, p) => a + p.extrasRappen, 0),
      mandatoryExtras: ps.flatMap((p) => p.mandatoryExtras),
      totalRappen: ps.reduce((a, p) => a + p.totalRappen, 0),
      discountRappen: ps.reduce((a, p) => a + p.discountRappen, 0),
    });
  }
  const rejected = ok[0].rejected.filter((r) => !offers.some((o) => o.ratePlan.id === r.ratePlanId));
  return { ok: true, offers, rejected, needsChildAges: ok[0].needsChildAges };
}
