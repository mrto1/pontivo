import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db, rows, type Executor } from "../db/client";
import {
  bookingExtras, bookingRooms, bookings, folioItems, groups as groupsTable, guests, hotels, invoiceLines, invoices, onsitePayments, roomTypes,
  type Booking, type FolioItem, type Hotel, type Invoice, type InvoiceLine, type InvoiceRecipient, type OnsitePayment,
} from "../db/schema";
import { addDays, diffDays, todayIn } from "../domain/dates";
import {
  cleanIban, DEFAULT_INVOICING, qrReference, isQrIban, isSwissIban, swissQrPayload, vatBps, vatBreakdown,
  type InvoicingSettings, type VatKind,
} from "../domain/invoice";
import { tr } from "../domain/blocks";
import { audit } from "./audit";
import { emailOutbox } from "../db/schema";

/**
 * Rechnung und Kasse (SPEC 16.3): Entwurf aus Buchung, Ausstellen (unveränderlich, lückenlose Nummer), Gutschrift,
 * Posten, Zahlungen vor Ort, QR-Rechnung. Preise sind Brutto; Geld immer in Rappen.
 */

export class InvoiceError extends Error {}

export const invoicingSettings = (hotel: Pick<Hotel, "content">): InvoicingSettings => ({ ...DEFAULT_INVOICING, ...(hotel.content?.invoicing ?? {}) });

export async function updateInvoicingSettings(hotel: Hotel, input: Partial<InvoicingSettings>, actor: string): Promise<void> {
  const cur = invoicingSettings(hotel);
  const next: InvoicingSettings = { ...cur, ...input };
  const iban = cleanIban(next.iban);
  if (iban && !isSwissIban(iban)) throw new InvoiceError("Die IBAN ist ungültig (erwartet: Schweizer oder liechtensteinische IBAN).");
  if (iban && isQrIban(iban)) throw new InvoiceError("Das ist eine QR-IBAN. Bitte hier die normale IBAN eintragen und die QR-IBAN im Feld «QR-IBAN» (optional).");
  const qrIban = cleanIban(next.qrIban ?? "");
  if (qrIban && !(isSwissIban(qrIban) && isQrIban(qrIban))) throw new InvoiceError("Die QR-IBAN ist ungültig (Schweizer IBAN mit Institutskennung 30000 bis 31999).");
  for (const [k, v, max] of [["Satz Beherbergung", next.stayBps, 2500], ["Satz übrige Leistungen", next.standardBps, 2500]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > max) throw new InvoiceError(`${k}: ungültiger Wert.`);
  }
  if (!Number.isInteger(next.paymentDays) || next.paymentDays < 0 || next.paymentDays > 120) throw new InvoiceError("Zahlungsfrist: 0 bis 120 Tage.");
  if (next.vatLiable && !next.vatNumber.trim()) throw new InvoiceError("Für MWST-pflichtige Betriebe braucht die Rechnung die MWST-Nummer (z. B. CHE-123.456.789 MWST).");
  const clean: InvoicingSettings = { ...next, iban, qrIban, vatNumber: next.vatNumber.trim().slice(0, 40), footer: next.footer.trim().slice(0, 500) };
  await db().update(hotels).set({ content: { ...hotel.content, invoicing: clean }, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "invoicing.settings", entity: "hotel", entityId: hotel.id, details: { vatLiable: clean.vatLiable } });
}

// ---------------------------------------------------------------- Saldo

export type BookingBalance = { totalRappen: number; voucherRappen: number; cardPaidRappen: number; onsitePaidRappen: number; paidRappen: number; openRappen: number };

/** Was die Buchung kostet, was bezahlt ist (Stripe netto nach Rückerstattungen + vor Ort), was offen ist. Posten (Folio) zählen zur Rechnung, nicht zu `total`. */
export async function bookingBalance(ex: Executor, hotelId: string, bookingId: string, includeFolio = true): Promise<BookingBalance & { folioRappen: number }> {
  const [b] = await ex.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
  if (!b) throw new InvoiceError("Buchung nicht gefunden.");
  const [p] = rows<{ s: number }>(await ex.execute(sql`SELECT coalesce(sum(amount_rappen - refunded_rappen),0)::int AS s FROM payments WHERE booking_id = ${bookingId} AND status IN ('succeeded','partially_refunded','refunded')`));
  const [o] = rows<{ s: number }>(await ex.execute(sql`SELECT coalesce(sum(amount_rappen),0)::int AS s FROM onsite_payments WHERE booking_id = ${bookingId}`));
  const [f] = rows<{ s: number }>(await ex.execute(sql`SELECT coalesce(sum(quantity * unit_price_rappen),0)::int AS s FROM folio_items WHERE booking_id = ${bookingId}`));
  const folio = includeFolio ? f.s : 0;
  const total = b.totalRappen + folio;
  const paid = p.s + o.s;
  return { totalRappen: total, voucherRappen: b.voucherRappen, cardPaidRappen: p.s, onsitePaidRappen: o.s, paidRappen: paid, openRappen: total - b.voucherRappen - paid, folioRappen: f.s };
}

// ---------------------------------------------------------------- Posten und Zahlungen vor Ort

export async function addFolioItem(hotelId: string, bookingId: string, input: { description: string; quantity: number; unitPriceRappen: number; vatKind: VatKind }, actor: string): Promise<FolioItem> {
  const description = input.description.trim();
  if (!description || description.length > 200) throw new InvoiceError("Bitte eine Beschreibung angeben.");
  if (!Number.isInteger(input.quantity) || input.quantity === 0 || Math.abs(input.quantity) > 999) throw new InvoiceError("Ungültige Menge.");
  if (!Number.isInteger(input.unitPriceRappen) || Math.abs(input.unitPriceRappen) > 10_000_000) throw new InvoiceError("Ungültiger Preis.");
  if (!["stay", "standard", "none"].includes(input.vatKind)) throw new InvoiceError("Ungültige MWST-Art.");
  return db().transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
    if (!b) throw new InvoiceError("Buchung nicht gefunden.");
    const [item] = await tx.insert(folioItems).values({ hotelId, bookingId, description, quantity: input.quantity, unitPriceRappen: input.unitPriceRappen, vatKind: input.vatKind, createdBy: actor }).returning();
    await audit(tx, { hotelId, actor, action: "folio.add", entity: "booking", entityId: bookingId, details: { description, amount: item.quantity * item.unitPriceRappen } });
    return item;
  });
}

export async function deleteFolioItem(hotelId: string, itemId: string, actor: string): Promise<void> {
  const [it] = await db().select().from(folioItems).where(and(eq(folioItems.id, itemId), eq(folioItems.hotelId, hotelId)));
  if (!it) throw new InvoiceError("Posten nicht gefunden.");
  if (it.invoiceId) throw new InvoiceError("Dieser Posten steht schon auf einer Rechnung. Korrektur per Gutschrift.");
  await db().delete(folioItems).where(eq(folioItems.id, itemId));
  await audit(db(), { hotelId, actor, action: "folio.delete", entity: "booking", entityId: it.bookingId, details: { description: it.description } });
}

export async function listFolio(hotelId: string, bookingId: string): Promise<FolioItem[]> {
  return db().select().from(folioItems).where(and(eq(folioItems.hotelId, hotelId), eq(folioItems.bookingId, bookingId))).orderBy(asc(folioItems.createdAt));
}

export async function recordOnsitePayment(
  hotel: Hotel, bookingId: string, input: { amountRappen: number; method: OnsitePayment["method"]; note?: string; receivedOn?: string }, actor: string, now = new Date(),
): Promise<OnsitePayment> {
  if (!Number.isInteger(input.amountRappen) || input.amountRappen === 0 || Math.abs(input.amountRappen) > 10_000_000) throw new InvoiceError("Bitte einen Betrag angeben (Rückzahlung: negativ).");
  if (!["cash", "card", "twint", "bank", "other"].includes(input.method)) throw new InvoiceError("Ungültige Zahlungsart.");
  const today = todayIn(hotel.timezone, now);
  const receivedOn = input.receivedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) ? input.receivedOn : today;
  if (receivedOn > today) throw new InvoiceError("Das Datum liegt in der Zukunft.");
  return db().transaction(async (tx) => {
    const [lock] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} AND hotel_id = ${hotel.id} FOR UPDATE`));
    if (!lock) throw new InvoiceError("Buchung nicht gefunden.");
    const [pay] = await tx.insert(onsitePayments).values({ hotelId: hotel.id, bookingId, amountRappen: input.amountRappen, method: input.method, note: (input.note ?? "").trim().slice(0, 200), receivedOn, actor }).returning();
    // Deckt die Zahlung die offene Restzahlung (Anzahlung), gilt sie als erledigt: keine Zahlungsaufforderungen mehr
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (b.balanceRappen > 0 && !b.balancePaidAt && !b.balanceOnsiteAt) {
      const bal = await bookingBalance(tx, hotel.id, bookingId, false);
      if (bal.openRappen <= 0) {
        await tx.update(bookings).set({ balanceOnsiteAt: now, updatedAt: now }).where(eq(bookings.id, bookingId));
        await tx.execute(sql`UPDATE email_outbox SET status = 'cancelled' WHERE booking_id = ${bookingId} AND status = 'pending' AND template IN ('balance_due','balance_reminder')`);
      }
    }
    await audit(tx, { hotelId: hotel.id, actor, action: "payment.onsite", entity: "booking", entityId: bookingId, details: { amount: pay.amountRappen, method: pay.method } });
    return pay;
  });
}

export async function listOnsitePayments(hotelId: string, bookingId: string): Promise<OnsitePayment[]> {
  return db().select().from(onsitePayments).where(and(eq(onsitePayments.hotelId, hotelId), eq(onsitePayments.bookingId, bookingId))).orderBy(asc(onsitePayments.createdAt));
}

// ---------------------------------------------------------------- Entwurf

type NewLine = Pick<InvoiceLine, "description" | "quantity" | "unitPriceRappen" | "amountRappen" | "vatBps" | "category">;

/** Rechnungszeilen aus der Buchung: Übernachtungen, Extras, Kurtaxe, Gutschein; dazu offene Posten */
async function bookingLines(ex: Executor, hotel: Hotel, booking: Booking, folio: FolioItem[]): Promise<NewLine[]> {
  const set = invoicingSettings(hotel);
  const lines: NewLine[] = [];
  const rr = await ex.select({ br: bookingRooms, name: roomTypes.name }).from(bookingRooms).innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId)).where(eq(bookingRooms.bookingId, booking.id));
  const n = diffDays(booking.checkin, booking.checkout);
  const stayBps = vatBps(set, "stay"), stdBps = vatBps(set, "standard");
  for (const r of rr) {
    lines.push({ description: `Übernachtung ${r.name}, ${booking.checkin} bis ${booking.checkout} (${n} ${n === 1 ? "Nacht" : "Nächte"})`, quantity: 1, unitPriceRappen: r.br.amountRappen, amountRappen: r.br.amountRappen, vatBps: stayBps, category: "stay" });
  }
  const ex2 = await ex.select().from(bookingExtras).where(eq(bookingExtras.bookingId, booking.id)).orderBy(asc(bookingExtras.position));
  for (const e of ex2) lines.push({ description: tr(e.name, "de") || "Zusatzleistung", quantity: e.quantity, unitPriceRappen: e.unitPriceRappen, amountRappen: e.amountRappen, vatBps: stdBps, category: "extra" });
  // Kurtaxe: nur wenn nicht schon im Preis enthalten; keine MWST-Leistung
  const known = lines.reduce((a, l) => a + l.amountRappen, 0);
  const tax = booking.totalRappen - known;
  if (tax > 0) lines.push({ description: "Kurtaxe", quantity: 1, unitPriceRappen: tax, amountRappen: tax, vatBps: 0, category: "tax" });
  else if (tax < 0 && lines.length) {
    // Rundungs-/Altdaten-Abweichung: in die erste Übernachtungszeile einrechnen, damit die Rechnung genau dem Buchungstotal entspricht
    lines[0] = { ...lines[0], amountRappen: lines[0].amountRappen + tax, unitPriceRappen: lines[0].unitPriceRappen + tax };
  }
  if (booking.voucherRappen > 0) lines.push({ description: "Gutschein", quantity: 1, unitPriceRappen: -booking.voucherRappen, amountRappen: -booking.voucherRappen, vatBps: 0, category: "discount" });
  for (const f of folio) lines.push({ description: f.description, quantity: f.quantity, unitPriceRappen: f.unitPriceRappen, amountRappen: f.quantity * f.unitPriceRappen, vatBps: vatBps(set, f.vatKind), category: f.unitPriceRappen < 0 ? "discount" : "extra" });
  return lines;
}

function recipientFromGuest(g?: { firstName: string; lastName: string; email: string } | null): InvoiceRecipient {
  return g ? { name: `${g.firstName} ${g.lastName}`.trim(), email: g.email, country: "CH" } : { country: "CH" };
}

/** Gehört die Buchung zu einer Gruppe mit Firma/Rechnungsadresse, geht die Rechnung an diese (SPEC 18.1); sonst an den Gast */
async function recipientForBooking(ex: Executor, booking: Booking, g?: { firstName: string; lastName: string; email: string } | null): Promise<InvoiceRecipient> {
  if (booking.groupId) {
    const [grp] = await ex.select().from(groupsTable).where(and(eq(groupsTable.id, booking.groupId), eq(groupsTable.hotelId, booking.hotelId)));
    if (grp && (grp.company || grp.contactName)) {
      return { company: grp.company || undefined, name: grp.contactName || undefined, street: grp.street || undefined, zip: grp.zip || undefined, city: grp.city || undefined, email: grp.contactEmail || g?.email || undefined, country: "CH" };
    }
  }
  return recipientFromGuest(g);
}

/** Entwurf aus der Buchung. Gibt es schon einen Entwurf, wird er zurückgegeben. Pro Buchung nur eine gültige (nicht gutgeschriebene) Rechnung. */
export async function createInvoiceDraft(hotel: Hotel, bookingId: string, actor: string): Promise<Invoice> {
  return db().transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotel.id))).for("update");
    if (!booking) throw new InvoiceError("Buchung nicht gefunden.");
    // ASSUMPTION: Rechnungen nur für bestätigte Buchungen; Stornogebühren/No-Show-Rechnungen später
    if (booking.status !== "confirmed") throw new InvoiceError("Rechnungen gibt es nur für bestätigte Buchungen.");
    const existing = await tx.select().from(invoices).where(and(eq(invoices.bookingId, bookingId), eq(invoices.kind, "invoice")));
    const draft = existing.find((i) => i.status === "draft");
    if (draft) return draft;
    const credited = new Set((await tx.select({ id: invoices.creditOf }).from(invoices).where(and(eq(invoices.bookingId, bookingId), eq(invoices.kind, "credit_note")))).map((x) => x.id));
    if (existing.some((i) => i.status === "issued" && !credited.has(i.id))) throw new InvoiceError("Für diese Buchung gibt es schon eine Rechnung. Für Korrekturen zuerst eine Gutschrift erstellen.");
    const [g] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
    const folio = await tx.select().from(folioItems).where(and(eq(folioItems.bookingId, bookingId), isNull(folioItems.invoiceId))).orderBy(asc(folioItems.createdAt));
    const lines = await bookingLines(tx, hotel, booking, folio);
    const [inv] = await tx.insert(invoices).values({ hotelId: hotel.id, bookingId, recipient: await recipientForBooking(tx, booking, g), createdBy: actor }).returning();
    await tx.insert(invoiceLines).values(lines.map((l, i) => ({ ...l, invoiceId: inv.id, hotelId: hotel.id, position: i })));
    if (folio.length) await tx.update(folioItems).set({ invoiceId: inv.id }).where(and(eq(folioItems.bookingId, bookingId), isNull(folioItems.invoiceId)));
    const vb = vatBreakdown(lines);
    const [done] = await tx.update(invoices).set({ totalRappen: vb.totalRappen, vatRappen: vb.vatRappen }).where(eq(invoices.id, inv.id)).returning();
    await audit(tx, { hotelId: hotel.id, actor, action: "invoice.draft", entity: "invoice", entityId: inv.id, details: { bookingId } });
    return done;
  });
}

export async function updateDraft(hotelId: string, invoiceId: string, input: { recipient: InvoiceRecipient; note: string }, actor: string): Promise<void> {
  const [inv] = await db().select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotelId)));
  if (!inv) throw new InvoiceError("Rechnung nicht gefunden.");
  if (inv.status !== "draft") throw new InvoiceError("Ausgestellte Rechnungen sind unveränderlich. Korrektur per Gutschrift.");
  const t = (v: string | undefined, n: number) => (v ?? "").trim().slice(0, n);
  const r = input.recipient;
  const recipient: InvoiceRecipient = { name: t(r.name, 100), company: t(r.company, 100), street: t(r.street, 100), zip: t(r.zip, 16), city: t(r.city, 60), country: t(r.country, 2).toUpperCase() || "CH", vatId: t(r.vatId, 40), email: t(r.email, 200) };
  await db().update(invoices).set({ recipient, note: t(input.note, 500) }).where(eq(invoices.id, invoiceId));
  await audit(db(), { hotelId, actor, action: "invoice.update", entity: "invoice", entityId: invoiceId, details: {} });
}

/** Entwurf verwerfen: Posten werden wieder frei */
export async function deleteDraft(hotelId: string, invoiceId: string, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotelId))).for("update");
    if (!inv) throw new InvoiceError("Rechnung nicht gefunden.");
    if (inv.status !== "draft") throw new InvoiceError("Nur Entwürfe können gelöscht werden.");
    await tx.update(folioItems).set({ invoiceId: null }).where(eq(folioItems.invoiceId, invoiceId));
    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
    await audit(tx, { hotelId, actor, action: "invoice.draft_delete", entity: "invoice", entityId: invoiceId, details: {} });
  });
}

// ---------------------------------------------------------------- Ausstellen und Gutschrift

/** Nächste Nummer «JJJJ-NNNN», lückenlos pro Betrieb und Jahr (Zähler wird in derselben Transaktion erhöht) */
async function nextNumber(tx: Executor, hotelId: string, year: number): Promise<string> {
  const [r] = rows<{ last: number }>(await tx.execute(sql`
    INSERT INTO invoice_counters (hotel_id, year, last) VALUES (${hotelId}, ${year}, 1)
    ON CONFLICT (hotel_id, year) DO UPDATE SET last = invoice_counters.last + 1 RETURNING last`));
  return `${year}-${String(r.last).padStart(4, "0")}`;
}

export async function issueInvoice(hotel: Hotel, invoiceId: string, actor: string, now = new Date()): Promise<Invoice> {
  const set = invoicingSettings(hotel);
  return db().transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotel.id))).for("update");
    if (!inv) throw new InvoiceError("Rechnung nicht gefunden.");
    if (inv.status !== "draft") throw new InvoiceError("Die Rechnung ist schon ausgestellt.");
    if (!inv.recipient.name?.trim() && !inv.recipient.company?.trim()) throw new InvoiceError("Bitte zuerst den Empfänger (Name oder Firma) angeben.");
    if (set.vatLiable && !set.vatNumber) throw new InvoiceError("MWST-Nummer fehlt (Einstellungen → Rechnung).");
    const today = todayIn(hotel.timezone, now);
    const number = await nextNumber(tx, hotel.id, Number(today.slice(0, 4)));
    const [done] = await tx.update(invoices).set({ status: "issued", number, issuedOn: today, dueOn: addDays(today, set.paymentDays), issuedAt: now }).where(eq(invoices.id, invoiceId)).returning();
    await audit(tx, { hotelId: hotel.id, actor, action: "invoice.issue", entity: "invoice", entityId: invoiceId, details: { number, total: done.totalRappen } });
    if (set.autoSend) await queueInvoiceMail(tx, hotel, done, actor);
    return done;
  });
}

/** Gutschrift zu einer ausgestellten Rechnung (negative Beträge, eigene Nummer). Posten der Rechnung werden wieder frei. */
export async function createCreditNote(hotel: Hotel, invoiceId: string, actor: string, now = new Date()): Promise<Invoice> {
  return db().transaction(async (tx) => {
    const [orig] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotel.id))).for("update");
    if (!orig || orig.kind !== "invoice") throw new InvoiceError("Rechnung nicht gefunden.");
    if (orig.status !== "issued") throw new InvoiceError("Nur ausgestellte Rechnungen können gutgeschrieben werden.");
    const [dup] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.creditOf, invoiceId), eq(invoices.kind, "credit_note")));
    if (dup) throw new InvoiceError("Zu dieser Rechnung gibt es schon eine Gutschrift.");
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position));
    const today = todayIn(hotel.timezone, now);
    const number = await nextNumber(tx, hotel.id, Number(today.slice(0, 4)));
    const [cn] = await tx.insert(invoices).values({
      hotelId: hotel.id, bookingId: orig.bookingId, kind: "credit_note", status: "issued", number, issuedOn: today, dueOn: null, recipient: orig.recipient, creditOf: orig.id,
      totalRappen: -orig.totalRappen, vatRappen: -orig.vatRappen, note: `Gutschrift zu Rechnung ${orig.number}`, createdBy: actor, issuedAt: now,
    }).returning();
    await tx.insert(invoiceLines).values(lines.map((l) => ({ invoiceId: cn.id, hotelId: hotel.id, position: l.position, description: l.description, quantity: l.quantity, unitPriceRappen: l.unitPriceRappen, amountRappen: -l.amountRappen, vatBps: l.vatBps, category: l.category })));
    await tx.update(folioItems).set({ invoiceId: null }).where(eq(folioItems.invoiceId, orig.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "invoice.credit_note", entity: "invoice", entityId: cn.id, details: { number, creditOf: orig.number } });
    if (invoicingSettings(hotel).autoSend) await queueInvoiceMail(tx, hotel, cn, actor);
    return cn;
  });
}

// ---------------------------------------------------------------- E-Mail

/**
 * Reiht die Mail mit dem Link zur Rechnung ein (Empfänger-Adresse der Rechnung, sonst die des Gastes).
 * Gibt false zurück, wenn keine Adresse bekannt ist. Erneutes Senden überschreibt den früheren Eintrag (Unique: Buchung/Vorlage/Adresse).
 */
async function queueInvoiceMail(ex: Executor, hotel: Hotel, inv: Invoice, actor: string): Promise<boolean> {
  if (inv.status !== "issued" || !inv.bookingId) return false;
  const [b] = await ex.select().from(bookings).where(and(eq(bookings.id, inv.bookingId), eq(bookings.hotelId, hotel.id)));
  if (!b) return false;
  const [g] = b.guestId ? await ex.select().from(guests).where(eq(guests.id, b.guestId)) : [];
  const to = (inv.recipient.email || g?.email || "").trim();
  if (!to) return false;
  const data = { invoiceId: inv.id, number: inv.number, kind: inv.kind, totalRappen: inv.totalRappen };
  await ex.insert(emailOutbox).values({ hotelId: hotel.id, bookingId: b.id, template: "invoice_sent", toEmail: to, language: b.language, data, sendAfter: new Date() })
    .onConflictDoUpdate({ target: [emailOutbox.bookingId, emailOutbox.template, emailOutbox.toEmail], set: { data, status: "pending", attempts: 0, sentAt: null, sendAfter: new Date(), language: b.language } });
  await ex.update(invoices).set({ emailedAt: new Date() }).where(eq(invoices.id, inv.id));
  await audit(ex, { hotelId: hotel.id, actor, action: "invoice.email", entity: "invoice", entityId: inv.id, details: { number: inv.number } });
  return true;
}

/** Manuell: Rechnung (oder Gutschrift) jetzt per E-Mail senden */
export async function sendInvoiceEmail(hotel: Hotel, invoiceId: string, actor: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotel.id)));
    if (!inv) throw new InvoiceError("Rechnung nicht gefunden.");
    if (inv.status !== "issued") throw new InvoiceError("Nur ausgestellte Rechnungen können gesendet werden.");
    if (!(await queueInvoiceMail(tx, hotel, inv, actor))) throw new InvoiceError("Keine E-Mail-Adresse bekannt. Bitte beim Empfänger eine E-Mail-Adresse eintragen (geht nur im Entwurf; sonst Gast-Adresse in der Buchung ergänzen).");
  });
}

// ---------------------------------------------------------------- Anzeige

export type InvoiceView = {
  invoice: Invoice; lines: InvoiceLine[]; vat: ReturnType<typeof vatBreakdown>; booking: Booking | null;
  paidRappen: number; openRappen: number; payments: { label: string; date: string; amountRappen: number }[];
  qrSvg: string | null; qrNote: string | null;
};

const METHOD: Record<string, string> = { cash: "bar", card: "Karte", twint: "TWINT", bank: "Überweisung", other: "andere" };

/** Daten für Druckansicht und Detailseite. Zahlungen sind der aktuelle Stand (auch nach dem Ausstellen); die Rechnung selbst bleibt unverändert. */
export async function invoiceView(hotel: Hotel, invoiceId: string): Promise<InvoiceView | null> {
  const [invoice] = await db().select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.hotelId, hotel.id)));
  if (!invoice) return null;
  const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position));
  const vat = vatBreakdown(lines);
  const [booking] = invoice.bookingId ? await db().select().from(bookings).where(eq(bookings.id, invoice.bookingId)) : [];
  let payments: InvoiceView["payments"] = [];
  let paid = 0;
  if (booking && invoice.kind === "invoice") {
    const st = rows<{ amount_rappen: number; refunded_rappen: number; method: string | null; created_at: string }>(await db().execute(sql`SELECT amount_rappen, refunded_rappen, method, created_at FROM payments WHERE booking_id = ${booking.id} AND status IN ('succeeded','partially_refunded','refunded') ORDER BY created_at`));
    for (const p of st) {
      const net = p.amount_rappen - p.refunded_rappen;
      if (net !== 0) { payments.push({ label: `Online${p.method ? ` (${p.method})` : ""}`, date: new Date(p.created_at).toISOString().slice(0, 10), amountRappen: net }); paid += net; }
    }
    for (const p of await listOnsitePayments(hotel.id, booking.id)) { payments.push({ label: `Vor Ort (${METHOD[p.method]})${p.note ? `, ${p.note}` : ""}`, date: p.receivedOn, amountRappen: p.amountRappen }); paid += p.amountRappen; }
    payments = payments.sort((a, b) => a.date.localeCompare(b.date));
  }
  const open = invoice.kind === "invoice" ? invoice.totalRappen - paid : 0;
  let qrSvg: string | null = null;
  let qrNote: string | null = null;
  const set = invoicingSettings(hotel);
  if (invoice.status === "issued" && invoice.kind === "invoice" && open > 0) {
    if (!set.iban && !set.qrIban) qrNote = "Keine IBAN hinterlegt: Die QR-Rechnung fehlt (Einstellungen → Rechnung).";
    else if (!hotel.postalCode || !hotel.city) qrNote = "Adresse des Betriebs unvollständig (PLZ/Ort): Die QR-Rechnung fehlt.";
    else qrSvg = await qrSvgFor(hotel, invoice, open, set);
  }
  return { invoice, lines, vat, booking: booking ?? null, paidRappen: paid, openRappen: open, payments, qrSvg, qrNote };
}

export function qrPayloadFor(hotel: Hotel, invoice: Invoice, openRappen: number, set: InvoicingSettings): string {
  const r = invoice.recipient;
  return swissQrPayload({
    iban: set.qrIban || set.iban,
    qrReference: set.qrIban && invoice.number ? qrReference(invoice.number) : undefined,
    creditor: { name: hotel.name, street: hotel.addressLine ?? "", zip: hotel.postalCode ?? "", city: hotel.city ?? "", country: "CH" },
    amountRappen: openRappen,
    debtor: r.zip && r.city && (r.company || r.name) ? { name: r.company || r.name || "", street: r.street, zip: r.zip, city: r.city, country: r.country || "CH" } : null,
    message: `Rechnung ${invoice.number}`,
  });
}

/** QR-Code mit Schweizer Kreuz in der Mitte (7 mm von 46 mm), als SVG */
async function qrSvgFor(hotel: Hotel, invoice: Invoice, open: number, set: InvoicingSettings): Promise<string> {
  const svg = await QRCode.toString(qrPayloadFor(hotel, invoice, open, set), { type: "svg", errorCorrectionLevel: "M", margin: 0 });
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const size = vb ? Number(vb[1]) : 0;
  if (!size) return svg;
  const c = size / 2, s = (size * 7) / 46;
  const rect = (w: number, h: number, fill: string) => `<rect x="${c - w / 2}" y="${c - h / 2}" width="${w}" height="${h}" fill="${fill}"/>`;
  const cross = `<g>${rect(s * 1.15, s * 1.15, "#fff")}${rect(s, s, "#000")}${rect(s * 0.2, s * 0.62, "#fff")}${rect(s * 0.62, s * 0.2, "#fff")}</g>`;
  return svg.replace("</svg>", `${cross}</svg>`);
}

export async function listInvoices(hotelId: string, filter: "all" | "draft" | "issued" = "all", limit = 200): Promise<(Invoice & { reference: string | null })[]> {
  const r = await db().select({ inv: invoices, reference: bookings.reference }).from(invoices).leftJoin(bookings, eq(bookings.id, invoices.bookingId))
    .where(and(eq(invoices.hotelId, hotelId), filter === "all" ? sql`true` : eq(invoices.status, filter))).orderBy(desc(invoices.createdAt)).limit(limit);
  return r.map((x) => ({ ...x.inv, reference: x.reference }));
}

export async function invoicesOfBooking(hotelId: string, bookingId: string): Promise<Invoice[]> {
  return db().select().from(invoices).where(and(eq(invoices.hotelId, hotelId), eq(invoices.bookingId, bookingId))).orderBy(asc(invoices.createdAt));
}
