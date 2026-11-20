import { searchParamsSchema } from "@/src/lib/validation";
import { apiJson, websiteAuth, apiError } from "@/src/lib/api-auth";
import { searchOffers } from "@/src/services/search";
import { isLocale } from "@/src/i18n/dict";
import { resolveCode } from "@/src/services/direct-tools";

export const dynamic = "force-dynamic";

/**
 * Verfügbarkeit und Preise (SPEC 19.22): GET ?checkin=&checkout=&adults=&children=&rooms=&ages=7,9&lang=de
 * Preise immer serverseitig berechnet (wie auf der Buchungsseite), in Rappen, inkl. Kurtaxe und obligatorischer Zusatzleistungen.
 */
export async function GET(req: Request) {
  const a = await websiteAuth(req);
  if (a instanceof Response) return a;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const q = searchParamsSchema.safeParse(sp);
  if (!q.success) return apiError(400, "invalid", q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const lang = isLocale(sp.lang ?? "") ? (sp.lang as "de") : "de";
  // optional ?company_code=: Firmenpreis (ungültiger Code → 422)
  const rc = sp.company_code ? await resolveCode(a.hotel, sp.company_code, q.data.checkin) : null;
  if (sp.company_code && !rc) return apiError(422, "code_invalid", "Der Firmencode ist ungültig oder abgelaufen.");
  const r = await searchOffers(a.hotel, { checkin: q.data.checkin, checkout: q.data.checkout, adults: q.data.adults, children: q.data.children, childrenAges: q.data.ages, rooms: q.data.rooms }, { lang, companyDiscountBps: rc?.code.discountBps });
  if (!r.ok) return apiError(422, r.error, `Suche nicht möglich: ${r.error}`);
  return apiJson({
    currency: "CHF", checkin: q.data.checkin, checkout: q.data.checkout, needs_child_ages: r.needsChildAges,
    offers: r.offers.map((o) => ({
      room_type_id: o.roomType.id, room_type_name: o.roomType.name, rate_plan_id: o.ratePlan.id, rate_plan_name: o.ratePlan.name, board: o.ratePlan.board,
      nightly_prices: o.nightlyPrices, rooms_total_rappen: o.roomsTotalRappen, tourist_tax_rappen: o.touristTaxRappen, tourist_tax_included: o.touristTaxIncluded,
      mandatory_extras: o.mandatoryExtras.map((e) => ({ name: e.name, amount_rappen: e.amountRappen })), total_rappen: o.totalRappen, cancellation_policy: o.cancellationPolicy,
      discount_rappen: o.discountRappen, discount_kind: o.adjustment?.kind ?? null,
    })),
  });
}
