import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bookings, hotels, invoiceLines, invoices, onsitePayments, type Hotel } from "../db/schema";
import { accountOk, ACCOUNT_KEYS, buildJournal, DEFAULT_ACCOUNTS, type AccountMap, type JInvoice, type JPayment, type JRow } from "../domain/accounting-export";
import { audit } from "./audit";

/** Buchungsjournal (SPEC 18.3). Jede Abfrage nach hotel_id. */
export class AccountingExportError extends Error {}

export const accountsOf = (hotel: Pick<Hotel, "content">): AccountMap => ({ ...DEFAULT_ACCOUNTS, ...(hotel.content.accounting?.accounts ?? {}) });

export async function saveAccounts(hotel: Hotel, input: Partial<AccountMap>, actor: string): Promise<void> {
  const next = { ...accountsOf(hotel) };
  for (const k of ACCOUNT_KEYS) {
    const v = (input[k] ?? next[k]).trim();
    if (!accountOk(v)) throw new AccountingExportError(`Konto «${v}» ungültig (Ziffern/Buchstaben, höchstens 20 Zeichen).`);
    next[k] = v;
  }
  await db().update(hotels).set({ content: { ...hotel.content, accounting: { ...(hotel.content.accounting ?? {}), accounts: next } }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "accounting.accounts", entity: "hotel", entityId: hotel.id, details: {} });
}

/** Einzelbuchungen für Rechnungen (Ausstelldatum) und Zahlungen (Zahldatum) von `from` bis `to` (inklusive) */
export async function journalFor(hotel: Hotel, from: string, to: string): Promise<JRow[]> {
  const invs = await db().select({ inv: invoices, ref: bookings.reference }).from(invoices).leftJoin(bookings, eq(bookings.id, invoices.bookingId))
    .where(and(eq(invoices.hotelId, hotel.id), eq(invoices.status, "issued"), sql`${invoices.issuedOn} BETWEEN ${from}::date AND ${to}::date`)).orderBy(asc(invoices.issuedOn), asc(invoices.number));
  const lines = invs.length ? await db().select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invs.map((i) => i.inv.id))) : [];
  const ji: JInvoice[] = invs.map(({ inv, ref }) => ({
    number: inv.number ?? "", kind: inv.kind, issuedOn: inv.issuedOn ?? from, reference: ref ?? "",
    recipient: [inv.recipient.company, inv.recipient.name].filter(Boolean).join(", "),
    lines: lines.filter((l) => l.invoiceId === inv.id).map((l) => ({ category: l.category, vatBps: l.vatBps, amountRappen: l.amountRappen })),
  }));
  const jp: JPayment[] = [];
  const stripe = rows<{ day: string; reference: string; net: number }>(await db().execute(sql`
    SELECT (p.created_at AT TIME ZONE ${hotel.timezone})::date::text AS day, b.reference, (p.amount_rappen - p.refunded_rappen)::int AS net
      FROM payments p JOIN bookings b ON b.id = p.booking_id
     WHERE b.hotel_id = ${hotel.id} AND p.status IN ('succeeded','partially_refunded','refunded')
       AND (p.created_at AT TIME ZONE ${hotel.timezone})::date BETWEEN ${from}::date AND ${to}::date`));
  for (const s of stripe) jp.push({ date: s.day, reference: s.reference, label: "online", account: "stripe", amountRappen: s.net });
  const onsite = await db().select({ p: onsitePayments, ref: bookings.reference }).from(onsitePayments).innerJoin(bookings, eq(bookings.id, onsitePayments.bookingId))
    .where(and(eq(onsitePayments.hotelId, hotel.id), sql`${onsitePayments.receivedOn} BETWEEN ${from}::date AND ${to}::date`));
  const LABEL = { cash: "bar", card: "Karte", twint: "TWINT", bank: "Überweisung", other: "andere" } as const;
  for (const o of onsite) jp.push({ date: o.p.receivedOn, reference: o.ref, label: LABEL[o.p.method], account: o.p.method, amountRappen: o.p.amountRappen });
  return buildJournal(ji, jp, accountsOf(hotel));
}

/** Zeitraum «JJJJ-MM», «JJJJ-Qn» oder «JJJJ» → von/bis (inklusive) */
export function periodRange(p: string): { from: string; to: string; label: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(p))) {
    const last = new Date(Date.UTC(+m[1], +m[2], 0)).toISOString().slice(0, 10);
    return { from: `${p}-01`, to: last, label: p };
  }
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) {
    const s = (Number(m[2]) - 1) * 3 + 1;
    return { from: `${m[1]}-${String(s).padStart(2, "0")}-01`, to: new Date(Date.UTC(+m[1], s + 2, 0)).toISOString().slice(0, 10), label: `${m[1]} Q${m[2]}` };
  }
  if ((m = /^(\d{4})$/.exec(p))) return { from: `${p}-01-01`, to: `${p}-12-31`, label: p };
  return null;
}
