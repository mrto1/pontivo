import type { Hotel } from "@/src/db/schema";
import type { Locale } from "@/src/i18n/dict";
import { ORD } from "@/src/i18n/order";
import { env } from "@/src/env";
import { formatInTimeZone } from "date-fns-tz";
import { formatChf } from "@/src/domain/money";
import { listZones, onlineMenu, onlineOrderingOn, orderByToken, orderingOpen, slotsToday } from "@/src/services/online-orders";
import { Shell } from "./Shell";
import { AutoRefresh } from "./AutoRefresh";
import { OrderCart } from "./OrderCart";
import { ClearCart } from "./ClearCart";
import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { posReceipts } from "@/src/db/schema";
import { invoicingSettings } from "@/src/services/invoicing";
import { formatBps } from "@/src/domain/invoice";
import { requestNow } from "@/src/lib/clock";
import { parseReferrer } from "@/src/domain/google";

type Sp = Record<string, string | string[] | undefined>;
const one = (sp: Sp, k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

/** Öffentliche Online-Bestellung (SPEC 20.4/20.5): Speisekarte, Warenkorb, Abholung oder Lieferung, Bezahlung */
export async function OrderPage({ hotel, locale, base, sp }: { hotel: Hotel; locale: Locale; base: string; sp: Sp }) {
  const t = ORD[locale];
  const now = await requestNow();
  const open = (await onlineOrderingOn(hotel.id)) ? await orderingOpen(hotel, now) : null;
  if (!open) {
    return (
      <Shell hotel={hotel} locale={locale} base={base} path="/bestellen" noBookButton>
        <section className="stack pad32-560"><h1>{t.title}</h1><p className="notice warn" data-testid="orders-closed">{t.closed}</p></section>
      </Shell>
    );
  }
  const cardOk = env().PAYMENT_PROVIDER !== "stripe" || !!(hotel.stripeAccountId && hotel.stripeChargesEnabled);
  const [menu, zones, pickupSlots] = await Promise.all([onlineMenu(hotel.id), open.delivery ? listZones(hotel.id) : Promise.resolve([]), open.pickup ? slotsToday(hotel, "pickup", 0, now) : Promise.resolve([])]);
  const active = zones.filter((z) => z.active);
  const extras = [...new Set(active.map((z) => z.extraMinutes))];
  const slotsBy = new Map(await Promise.all(extras.map(async (m) => [m, (await slotsToday(hotel, "delivery", m, now)).filter((x) => x.ok).map((x) => x.time)] as const)));
  return (
    <Shell hotel={hotel} locale={locale} base={base} path="/bestellen" noBookButton>
      <h1 className="mt32">{t.title}</h1>
      <OrderCart referrer={parseReferrer(one(sp, "ref"))} hotelId={hotel.id} locale={locale} base={base} menu={menu} phone={hotel.contactPhone} msg={one(sp, "msg") ?? null} aborted={!!one(sp, "abgebrochen")} cardOk={cardOk}
        pickup={{ on: open.pickup, slots: pickupSlots.filter((x) => x.ok).map((x) => x.time), cash: open.cashPickup }}
        delivery={{ on: open.delivery, cash: open.cashDelivery, cashMaxRappen: open.cashMaxRappen, zones: active.map((z) => ({ id: z.id, name: z.name, active: true, postalCodes: z.postalCodes, minOrderRappen: z.minOrderRappen, feeRappen: z.feeRappen, freeFromRappen: z.freeFromRappen, extraMinutes: z.extraMinutes, slots: slotsBy.get(z.extraMinutes) ?? [] })) }} />
    </Shell>
  );
}

const LIVE = new Set(["pending_payment", "new", "accepted", "ready", "out"]);

/** Statusseite einer Bestellung (Link aus Mail und nach dem Bestellen), lädt von selbst neu */
export async function OrderStatusPage({ hotel, locale, base, token, sp }: { hotel: Hotel; locale: Locale; base: string; token: string; sp: Sp }) {
  const t = ORD[locale];
  const o = await orderByToken(token);
  if (!o || o.hotelId !== hotel.id) {
    return <Shell hotel={hotel} locale={locale} base={base} noBookButton><section className="pad32"><h1>{t.title}</h1><p className="notice warn">–</p></section></Shell>;
  }
  const hm = (d: Date) => formatInTimeZone(d, hotel.timezone, "HH:mm");
  // Quittung (SPEC 20.8): Bon der Online-Bestellung mit MWST, auch ohne Modul Kasse
  const [rec] = o.receiptId ? await db().select().from(posReceipts).where(and(eq(posReceipts.id, o.receiptId), eq(posReceipts.hotelId, hotel.id))) : [];
  const inv = invoicingSettings(hotel);
  const when = o.promisedAt ?? o.requestedAt;
  return (
    <Shell hotel={hotel} locale={locale} base={base} path={`/bestellung/${token}`} noBookButton>
      {LIVE.has(o.status) ? <AutoRefresh seconds={15} /> : null}
      {one(sp, "neu") || one(sp, "paid") ? <ClearCart hotelId={hotel.id} /> : null}
      <section className="stack pad32-560" data-testid="order-status">
        <h1>{t.number} {o.number}</h1>
        <p className={`notice${["rejected", "expired", "cancelled", "not_accepted"].includes(o.status) ? " warn" : ""}`} data-status={o.status}>
          {t.status[o.status] ?? o.status}{o.status === "rejected" && o.rejectReason ? ` (${o.rejectReason})` : ""}
          {["accepted", "ready"].includes(o.status) || o.status === "new" ? <><br /><strong>{o.kind === "delivery" ? t.deliverAt(hm(when)) : t.at(hm(when))}</strong></> : null}
        </p>
        {o.refundedAt || (["rejected", "expired"].includes(o.status) && o.payment === "card") ? <p className="small">{t.refunded}</p> : null}
        <ul className="list">
          {o.items.map((l, i) => <li key={i}>{l.quantity} × {l.description}{l.note ? <span className="small muted"> – {l.note}</span> : null} <span className="small">{formatChf(l.unitPriceRappen * l.quantity)}</span></li>)}
          {o.deliveryFeeRappen ? <li>{t.deliveryFee} <span className="small">{formatChf(o.deliveryFeeRappen)}</span></li> : null}
        </ul>
        <p><strong>{t.total} {formatChf(o.totalRappen)}</strong> · {o.payment === "card" ? t.payCard : o.kind === "pickup" ? t.cashPickup : t.cashDelivery}</p>
        {o.kind === "delivery" ? <p className="small">{o.street} {o.houseNo}, {o.postalCode} {o.city}</p> : <p className="small">{hotel.name}{hotel.addressLine ? `, ${hotel.addressLine}` : ""}{hotel.city ? `, ${hotel.postalCode ?? ""} ${hotel.city}` : ""}</p>}
        {hotel.contactPhone ? <p className="small"><a href={`tel:${hotel.contactPhone}`}>{hotel.contactPhone}</a></p> : null}
        {rec ? (
          <div className="card small" data-testid="order-receipt">
            <strong>{t.receipt} {rec.number}</strong> · {formatInTimeZone(rec.paidAt, hotel.timezone, "dd.MM.yyyy HH:mm")}<br />
            {hotel.legalName ?? hotel.name}{inv.vatLiable && inv.vatNumber ? ` · ${inv.vatNumber}` : ""}
            {rec.vat.filter((v) => v.bps > 0).map((v) => <div key={v.bps}>{t.vat} {formatBps(v.bps)}: {formatChf(v.vatRappen)} ({formatChf(v.grossRappen)})</div>)}
          </div>
        ) : null}
        <p><a href={`${base}/${locale}`}>{t.back}</a> · <a href={`${base}/${locale}/bestellen`}>{t.again}</a></p>
      </section>
    </Shell>
  );
}
