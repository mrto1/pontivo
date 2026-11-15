import { and, asc, eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bankEntries, bookings, companies, guests, invoiceDunnings, invoices, emailOutbox, type Company, type Hotel, type Invoice } from "../db/schema";
import { bucketOf, matchByReference, nextDunningLevel, parseCamt054, type Bucket, type BankEntry } from "../domain/debtors";
import { diffDays, todayIn } from "../domain/dates";
import { audit } from "./audit";
import { InvoiceError, recordOnsitePayment } from "./invoicing";

export class DebtorError extends Error {}

// ---------------------------------------------------------------- Firmenkunden

export type CompanyInput = { name: string; street?: string; zip?: string; city?: string; country?: string; vatId?: string; email?: string; paymentDays?: number | null; note?: string; active?: boolean };

export async function listCompanies(hotelId: string, onlyActive = false): Promise<Company[]> {
  const w = onlyActive ? and(eq(companies.hotelId, hotelId), eq(companies.active, true)) : eq(companies.hotelId, hotelId);
  return db().select().from(companies).where(w).orderBy(asc(companies.name));
}

export async function saveCompany(hotelId: string, id: string | null, input: CompanyInput, actor: string): Promise<Company> {
  const t = (v: string | undefined, n: number) => (v ?? "").trim().slice(0, n);
  const name = t(input.name, 120);
  if (!name) throw new DebtorError("Der Firmenname fehlt.");
  const email = t(input.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DebtorError("Die E-Mail-Adresse ist ungültig.");
  const days = input.paymentDays ?? null;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) throw new DebtorError("Zahlungsfrist: 0 bis 365 Tage.");
  const v = { name, street: t(input.street, 100), zip: t(input.zip, 16), city: t(input.city, 60), country: t(input.country, 2).toUpperCase() || "CH", vatId: t(input.vatId, 40), email, paymentDays: days, note: t(input.note, 500), active: input.active ?? true };
  return db().transaction(async (tx) => {
    let c: Company;
    if (id) {
      const [u] = await tx.update(companies).set(v).where(and(eq(companies.id, id), eq(companies.hotelId, hotelId))).returning();
      if (!u) throw new DebtorError("Firma nicht gefunden.");
      c = u;
    } else {
      [c] = await tx.insert(companies).values({ hotelId, ...v }).returning();
    }
    await audit(tx, { hotelId, actor, action: id ? "company.update" : "company.create", entity: "company", entityId: c.id, details: { name } });
    return c;
  });
}

/** Buchung einer Firma zuordnen (oder lösen). Nur solange keine gültige Rechnung ausgestellt ist, denn die Rechnung bleibt unverändert. */
export async function setBookingCompany(hotelId: string, bookingId: string, companyId: string | null, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId))).for("update");
    if (!b) throw new DebtorError("Buchung nicht gefunden.");
    if (companyId) {
      const [c] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), eq(companies.hotelId, hotelId), eq(companies.active, true)));
      if (!c) throw new DebtorError("Firma nicht gefunden.");
    }
    const issued = rows<{ n: number }>(await tx.execute(sql`
      SELECT count(*)::int AS n FROM invoices i WHERE i.booking_id = ${bookingId} AND i.kind = 'invoice' AND i.status = 'issued'
         AND NOT EXISTS (SELECT 1 FROM invoices c WHERE c.credit_of = i.id AND c.kind = 'credit_note')`))[0].n;
    if (issued > 0) throw new DebtorError("Für diese Buchung ist schon eine Rechnung ausgestellt. Zuerst eine Gutschrift erstellen.");
    await tx.update(bookings).set({ companyId }).where(eq(bookings.id, bookingId));
    // Offener Entwurf: Firma übernehmen
    await tx.update(invoices).set({ companyId }).where(and(eq(invoices.bookingId, bookingId), eq(invoices.status, "draft")));
    await audit(tx, { hotelId, actor, action: "booking.company", entity: "booking", entityId: bookingId, details: { companyId } });
  });
}

// ---------------------------------------------------------------- Offene Rechnungen

export type OpenInvoice = {
  id: string; number: string; reference: string; bookingId: string | null; companyId: string | null; payer: string; issuedOn: string; dueOn: string;
  totalRappen: number; paidRappen: number; openRappen: number; daysOverdue: number; bucket: Bucket; lastLevel: number; nextLevel: 1 | 2 | 3 | null;
};

export async function listOpenInvoices(hotel: Hotel, now = new Date()): Promise<OpenInvoice[]> {
  const today = todayIn(hotel.timezone, now);
  const r = rows<{ id: string; number: string; reference: string; booking_id: string | null; company_id: string | null; recipient: { company?: string; name?: string }; issued_on: string; due_on: string | null; total: number; paid: number; last_level: number }>(await db().execute(sql`
    SELECT i.id, i.number, b.reference, i.booking_id, i.company_id, i.recipient, i.issued_on::text, i.due_on::text, i.total_rappen AS total,
           (coalesce((SELECT sum(p.amount_rappen - p.refunded_rappen) FROM payments p WHERE p.booking_id = i.booking_id AND p.status IN ('succeeded','partially_refunded','refunded')), 0)
          + coalesce((SELECT sum(o.amount_rappen) FROM onsite_payments o WHERE o.booking_id = i.booking_id), 0))::int AS paid,
           coalesce((SELECT max(d.level) FROM invoice_dunnings d WHERE d.invoice_id = i.id), 0)::int AS last_level
      FROM invoices i JOIN bookings b ON b.id = i.booking_id
     WHERE i.hotel_id = ${hotel.id} AND i.kind = 'invoice' AND i.status = 'issued'
       AND NOT EXISTS (SELECT 1 FROM invoices c WHERE c.credit_of = i.id AND c.kind = 'credit_note')
     ORDER BY i.due_on, i.number`));
  return r.filter((x) => x.total - x.paid > 0).map((x) => {
    const due = x.due_on ?? x.issued_on;
    const days = diffDays(due, today);
    return {
      id: x.id, number: x.number, reference: x.reference, bookingId: x.booking_id, companyId: x.company_id, payer: x.recipient.company || x.recipient.name || "–",
      issuedOn: x.issued_on, dueOn: due, totalRappen: x.total, paidRappen: x.paid, openRappen: x.total - x.paid,
      daysOverdue: days, bucket: bucketOf(days), lastLevel: x.last_level, nextLevel: nextDunningLevel(days, x.last_level),
    };
  });
}

export function agingTotals(list: OpenInvoice[]): Record<Bucket, number> {
  const t: Record<Bucket, number> = { not_due: 0, d1_30: 0, d31_60: 0, d60_plus: 0 };
  for (const i of list) t[i.bucket] += i.openRappen;
  return t;
}

// ---------------------------------------------------------------- Zahlungseingang

/** Zahlungseingang zu einer Rechnung (Überweisung). Datum in einem abgeschlossenen Tag: es gilt heute, das Valuta steht in der Notiz. */
export async function recordInvoicePayment(hotel: Hotel, invoiceId: string, input: { amountRappen: number; receivedOn?: string; note?: string }, actor: string, now = new Date()): Promise<void> {
  const [inv] = await db().select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotel.id)));
  if (!inv || inv.kind !== "invoice" || inv.status !== "issued" || !inv.bookingId) throw new DebtorError("Rechnung nicht gefunden.");
  const note = `Rechnung ${inv.number}${input.note ? `, ${input.note}` : ""}`;
  try {
    await recordOnsitePayment(hotel, inv.bookingId, { amountRappen: input.amountRappen, method: "bank", note, receivedOn: input.receivedOn }, actor, now);
  } catch (e) {
    if (!(e instanceof InvoiceError) || !input.receivedOn || !/abgeschlossen/i.test(e.message)) throw e;
    await recordOnsitePayment(hotel, inv.bookingId, { amountRappen: input.amountRappen, method: "bank", note: `${note} (Valuta ${input.receivedOn})` }, actor, now);
  }
}

export type BankImportResult = { entries: number; matched: { invoiceNumber: string; amountRappen: number }[]; unmatched: BankEntry[]; duplicates: number };

/** camt.054 einlesen: Gutschriften mit passender QR-Referenz werden verbucht, jeder Eintrag nur einmal */
export async function importBankFile(hotel: Hotel, xml: string, actor: string, now = new Date()): Promise<BankImportResult> {
  const entries = parseCamt054(xml);
  if (!entries.length) throw new DebtorError("Keine Gutschriften in der Datei gefunden (erwartet: camt.054).");
  const open = (await listOpenInvoices(hotel, now)).map((o) => ({ ...o }));
  const res: BankImportResult = { entries: entries.length, matched: [], unmatched: [], duplicates: 0 };
  for (const e of entries) {
    const inv = matchByReference(e.reference, open);
    if (!inv) {
      const [known] = await db().select({ id: bankEntries.id }).from(bankEntries).where(and(eq(bankEntries.hotelId, hotel.id), eq(bankEntries.dedupeKey, e.dedupeKey)));
      if (known) res.duplicates++; else res.unmatched.push(e);
      continue;
    }
    const [row] = await db().insert(bankEntries).values({ hotelId: hotel.id, dedupeKey: e.dedupeKey, bookedOn: e.bookedOn, amountRappen: e.amountRappen, reference: e.reference, invoiceId: inv.id, status: "matched" }).onConflictDoNothing().returning({ id: bankEntries.id });
    if (!row) { res.duplicates++; continue; }
    try {
      await recordInvoicePayment(hotel, inv.id, { amountRappen: e.amountRappen, receivedOn: e.bookedOn, note: "Bankdatei" }, actor, now);
    } catch (err) {
      await db().delete(bankEntries).where(eq(bankEntries.id, row.id));
      throw err;
    }
    inv.openRappen -= e.amountRappen;
    res.matched.push({ invoiceNumber: inv.number, amountRappen: e.amountRappen });
  }
  return res;
}

// ---------------------------------------------------------------- Mahnwesen

/** Zahlungserinnerung/Mahnung senden: nur die nächste fällige Stufe, per E-Mail an die Adresse der Rechnung (sonst des Gastes) */
export async function sendDunning(hotel: Hotel, invoiceId: string, actor: string, now = new Date()): Promise<1 | 2 | 3> {
  const open = (await listOpenInvoices(hotel, now)).find((o) => o.id === invoiceId);
  if (!open) throw new DebtorError("Die Rechnung ist nicht offen.");
  if (!open.nextLevel) throw new DebtorError(open.lastLevel >= 3 ? "Alle drei Stufen sind schon gesendet." : "Noch nicht fällig für die nächste Stufe.");
  const level = open.nextLevel;
  const today = todayIn(hotel.timezone, now);
  return db().transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotel.id))).for("update");
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, inv.bookingId!), eq(bookings.hotelId, hotel.id)));
    const [g] = b.guestId ? await tx.select().from(guests).where(eq(guests.id, b.guestId)) : [];
    const to = (inv.recipient.email || g?.email || "").trim();
    if (!to) throw new DebtorError("Keine E-Mail-Adresse bekannt (Firma oder Gast).");
    const ins = await tx.insert(invoiceDunnings).values({ hotelId: hotel.id, invoiceId, level, sentOn: today, sentTo: to, sentBy: actor }).onConflictDoNothing().returning({ id: invoiceDunnings.id });
    if (!ins.length) throw new DebtorError("Diese Stufe wurde schon gesendet.");
    const data = { invoiceId, number: inv.number, level, totalRappen: inv.totalRappen, openRappen: open.openRappen, dueOn: open.dueOn };
    await tx.insert(emailOutbox).values({ hotelId: hotel.id, bookingId: b.id, template: "dunning", toEmail: to, language: b.language, data, sendAfter: new Date() })
      .onConflictDoUpdate({ target: [emailOutbox.bookingId, emailOutbox.template, emailOutbox.toEmail], set: { data, status: "pending", attempts: 0, sentAt: null, sendAfter: new Date(), language: b.language } });
    await audit(tx, { hotelId: hotel.id, actor, action: "invoice.dunning", entity: "invoice", entityId: invoiceId, details: { number: inv.number, level, open: open.openRappen } });
    return level;
  });
}

export async function listDunnings(hotelId: string, invoiceId: string) {
  return db().select().from(invoiceDunnings).where(and(eq(invoiceDunnings.hotelId, hotelId), eq(invoiceDunnings.invoiceId, invoiceId))).orderBy(asc(invoiceDunnings.level));
}

export type { Invoice };
