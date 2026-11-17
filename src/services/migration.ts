import { and, desc, eq, sql } from "drizzle-orm";
import { db, rows, type Tx } from "../db/client";
import { bookingRooms, bookings, guests, importJobs, invoices, onsitePayments, ratePlans, roomTypes, vouchers, type Hotel, type ImportJob, type ImportSummary } from "../db/schema";
import { addDays, nightsOf, todayIn } from "../domain/dates";
import { newPublicToken, newReference } from "../domain/ids";
import { IMPORT_COLUMNS, parseImport, toCsv, type ImportRow } from "../domain/import-csv";
import { audit } from "./audit";
import { ensureInventory } from "./inventory";
import { enqueueAvailability } from "./outbox";
import { releaseNights, reserveNights } from "./bookings";
import { bookingBalance } from "./invoicing";

/**
 * Datenübernahme aus der bisherigen Software (PMS-ERSATZ E1, SPEC 19.19).
 * Trockenlauf und Import laufen über denselben Code: der Trockenlauf macht alles in einer Transaktion und rollt am Ende zurück.
 * ASSUMPTION: Nur Reservierungen (inkl. Gäste) aus dem generischen CSV, direkt verarbeitet (höchstens 2000 Zeilen je Datei, kein Hintergrundjob).
 */
export class ImportError extends Error {}
class DryRollback extends Error {}

const MAX_ISSUES = 200;
const IMPORT_ACTOR = (jobId: string) => `import:${jobId}`;

/** Gesamtpreis gleichmässig auf die Nächte verteilen (Rest auf die ersten Nächte) */
export function spreadNights(totalRappen: number, nights: string[]) {
  const base = Math.floor(totalRappen / nights.length), rest = totalRappen - base * nights.length;
  return nights.map((night, i) => ({ night, price_rappen: base + (i < rest ? 1 : 0) }));
}

async function process(hotel: Hotel, job: ImportJob, csv: string, dry: boolean, actor: string): Promise<ImportSummary> {
  const parsed = parseImport(csv);
  const issues: ImportSummary["issues"] = parsed.problems.map((p) => ({ row: p.row, severity: "error", message: p.message }));
  const sum: ImportSummary = { total: parsed.total, created: 0, skipped: 0, errors: parsed.problems.length, warnings: 0, past: 0, future: 0, issues, sample: [] };
  const note = (row: number, severity: "error" | "warn", message: string) => {
    if (severity === "error") sum.errors++; else sum.warnings++;
    if (issues.length < MAX_ISSUES) issues.push({ row, severity, message });
  };
  const types = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id));
  const plans = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, hotel.id));
  const today = todayIn(hotel.timezone);
  const seen = new Set<string>();
  try {
    await db().transaction(async (tx) => {
      for (const r of parsed.rows) {
        if (seen.has(r.ref)) { note(r.row, "error", `Buchungsnummer «${r.ref}» kommt in der Datei mehrfach vor.`); continue; }
        seen.add(r.ref);
        const type = types.find((t) => t.name.trim().toLowerCase() === r.roomType.toLowerCase());
        if (!type) { note(r.row, "error", `Zimmertyp «${r.roomType}» gibt es in Pontivo nicht. Vorhanden: ${types.map((t) => t.name).join(", ") || "keiner"}.`); continue; }
        const plan = r.ratePlan ? plans.find((p) => p.roomTypeId === type.id && p.name.trim().toLowerCase() === r.ratePlan.toLowerCase()) : undefined;
        if (r.ratePlan && !plan) { note(r.row, "error", `Tarif «${r.ratePlan}» gibt es beim Zimmertyp «${type.name}» nicht.`); continue; }
        const [dupe] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.sourceRef, r.ref)));
        if (dupe) { sum.skipped++; note(r.row, "warn", `«${r.ref}» wurde schon früher übernommen und wird übersprungen.`); continue; }
        try {
          await tx.transaction((sp) => insertRow(sp, hotel, job, r, type.id, plan?.id ?? null, today, sum, actor));
          sum.created++;
          if (sum.sample.length < 10) sum.sample.push({ row: r.row, ref: r.ref, guest: `${r.firstName} ${r.lastName}`, checkin: r.checkin, checkout: r.checkout });
        } catch (e) {
          if (e instanceof ImportError) note(r.row, "error", e.message);
          else throw e;
        }
      }
      if (dry || sum.errors > 0) throw new DryRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRollback)) throw e;
    // zurückgerollt: nichts wurde geschrieben, die Zähler bleiben als Vorschau
  }
  return sum;
}

async function insertRow(tx: Tx, hotel: Hotel, job: ImportJob, r: ImportRow, roomTypeId: string, ratePlanId: string | null, today: string, sum: ImportSummary, actor: string) {
  const nights = nightsOf(r.checkin, r.checkout);
  const occupies = !r.cancelled && r.checkout > today;
  if (r.cancelled) { /* nur Historie */ } else if (occupies) sum.future++; else sum.past++;
  if (occupies) {
    const from = r.checkin > today ? r.checkin : today;
    await ensureInventory(tx, hotel.id, roomTypeId, from, r.checkout);
    if (!(await reserveNights(tx, roomTypeId, from, r.checkout))) throw new ImportError(`Überbuchung: «${r.ref}» (${r.checkin} bis ${r.checkout}): für diesen Zimmertyp ist in diesem Zeitraum nichts mehr frei. Zimmertyp ändern oder Zeile weglassen.`);
  }
  let guestId: string | undefined;
  if (r.email) [{ id: guestId } = { id: undefined }] = await tx.select({ id: guests.id }).from(guests).where(and(eq(guests.hotelId, hotel.id), sql`lower(${guests.email}) = ${r.email}`)).limit(1);
  if (!guestId) {
    // Marketing-Einwilligung wird nie übernommen (PMS-ERSATZ 2.8)
    [{ id: guestId }] = await tx.insert(guests).values({ hotelId: hotel.id, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone || null, language: r.language, importJobId: job.id }).returning({ id: guests.id });
  }
  const now = new Date();
  const [b] = await tx.insert(bookings).values({
    hotelId: hotel.id, reference: newReference(), publicToken: newPublicToken(), source: "import", status: r.cancelled ? "cancelled" : "confirmed",
    confirmedAt: r.cancelled ? null : now, cancelledAt: r.cancelled ? now : null, cancelReason: r.cancelled ? "Übernahme: in der bisherigen Software storniert" : null,
    checkin: r.checkin, checkout: r.checkout, adults: r.adults, children: r.children, language: r.language, guestId,
    roomsTotalRappen: r.totalRappen, totalRappen: r.totalRappen, platformFeeRappen: 0, guestNotes: r.note || null, sourceRef: r.ref, importJobId: job.id,
  }).returning();
  await tx.insert(bookingRooms).values({ bookingId: b.id, hotelId: hotel.id, roomTypeId, ratePlanId, adults: r.adults, children: r.children, nightlyPrices: spreadNights(r.totalRappen, nights), amountRappen: r.totalRappen });
  if (r.paidRappen > 0 && !r.cancelled) {
    await tx.insert(onsitePayments).values({ hotelId: hotel.id, bookingId: b.id, amountRappen: r.paidRappen, method: "other", note: "Übernahme aus bisheriger Software", receivedOn: today, actor: IMPORT_ACTOR(job.id) });
  }
  if (occupies) await enqueueAvailability(tx, hotel.id, roomTypeId, r.checkin > today ? r.checkin : today, addDays(r.checkout, -1));
  await audit(tx, { hotelId: hotel.id, actor, action: "booking.import", entity: "booking", entityId: b.id, details: { jobId: job.id, ref: r.ref, total: r.totalRappen } });
}

/** Datei prüfen (Trockenlauf): legt den Auftrag an, schreibt keine Buchungen */
export async function createImportCheck(hotel: Hotel, csv: string, filename: string, actor: string): Promise<ImportJob> {
  if (csv.length > 5_000_000) throw new ImportError("Die Datei ist zu gross (höchstens 5 MB).");
  const [job] = await db().insert(importJobs).values({ hotelId: hotel.id, status: "checked", filename: filename.slice(0, 200), csv, createdBy: actor }).returning();
  const summary = await process(hotel, job, csv, true, actor);
  const [upd] = await db().update(importJobs).set({ summary }).where(eq(importJobs.id, job.id)).returning();
  await audit(db(), { hotelId: hotel.id, actor, action: "import.check", entity: "import_job", entityId: job.id, details: { errors: summary.errors, warnings: summary.warnings, rows: summary.total } });
  return upd;
}

async function ownJob(hotelId: string, jobId: string): Promise<ImportJob> {
  const [job] = await db().select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.hotelId, hotelId)));
  if (!job) throw new ImportError("Übernahme nicht gefunden.");
  return job;
}

/** Import ausführen: nur ohne Fehler (auch keine Überbuchung); alles oder nichts */
export async function runImport(hotel: Hotel, jobId: string, actor: string): Promise<ImportJob> {
  const job = await ownJob(hotel.id, jobId);
  if (job.status !== "checked" || !job.csv) throw new ImportError("Diese Übernahme lässt sich nicht mehr ausführen. Bitte die Datei neu prüfen.");
  const summary = await process(hotel, job, job.csv, false, actor);
  if (summary.errors > 0) {
    await db().update(importJobs).set({ summary }).where(eq(importJobs.id, job.id));
    throw new ImportError("Der Import wurde nicht ausgeführt: Es gibt noch Fehler. Es wurde nichts geschrieben.");
  }
  const [done] = await db().update(importJobs).set({ status: "done", csv: null, summary, finishedAt: new Date() }).where(eq(importJobs.id, job.id)).returning();
  await audit(db(), { hotelId: hotel.id, actor, action: "import.run", entity: "import_job", entityId: job.id, details: { created: summary.created, skipped: summary.skipped } });
  return done;
}

/** Rückgängig: Buchungen des Auftrags ohne spätere Zahlung oder Rechnung verschwinden, Nächte werden frei; der Rest wird gemeldet */
export async function undoImport(hotel: Hotel, jobId: string, actor: string): Promise<ImportJob> {
  const job = await ownJob(hotel.id, jobId);
  if (job.status !== "done") throw new ImportError("Nur ein ausgeführter Import lässt sich rückgängig machen.");
  const today = todayIn(hotel.timezone);
  const kept: { ref: string; reason: string }[] = [];
  let removed = 0;
  const list = await db().select().from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.importJobId, job.id)));
  for (const b of list) {
    const ref = b.sourceRef ?? b.reference;
    const [x] = rows<{ n: number }>(await db().execute(sql`SELECT (
        (SELECT count(*) FROM payments WHERE booking_id = ${b.id})
      + (SELECT count(*) FROM folio_items WHERE booking_id = ${b.id})
      + (SELECT count(*) FROM invoices WHERE booking_id = ${b.id})
      + (SELECT count(*) FROM onsite_payments WHERE booking_id = ${b.id} AND actor <> ${IMPORT_ACTOR(job.id)}))::int AS n`));
    if (x.n > 0) { kept.push({ ref, reason: "Seither wurden Zahlungen, Posten oder Rechnungen erfasst." }); continue; }
    try {
      await db().transaction(async (tx) => {
        const rooms = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
        if (b.status === "confirmed" && b.checkout > today) for (const rm of rooms) await releaseNights(tx, hotel.id, rm.roomTypeId, b.checkin > today ? b.checkin : today, b.checkout);
        await tx.delete(onsitePayments).where(eq(onsitePayments.bookingId, b.id));
        await tx.delete(bookings).where(and(eq(bookings.id, b.id), eq(bookings.hotelId, hotel.id)));
        await audit(tx, { hotelId: hotel.id, actor, action: "booking.import_undo", entity: "booking", entityId: b.id, details: { jobId: job.id, ref } });
      });
      removed++;
    } catch (e) {
      if (String((e as { code?: string }).code) !== "23503") throw e;
      kept.push({ ref, reason: "Es hängen weitere Daten daran (z. B. Zutritt, Posteingang)." });
    }
  }
  await db().execute(sql`DELETE FROM guests g WHERE g.hotel_id = ${hotel.id} AND g.import_job_id = ${job.id} AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.guest_id = g.id)`);
  const [upd] = await db().update(importJobs).set({ status: "undone", csv: null, finishedAt: new Date(), summary: { ...job.summary, undone: { removed, kept } } }).where(eq(importJobs.id, job.id)).returning();
  await audit(db(), { hotelId: hotel.id, actor, action: "import.undo", entity: "import_job", entityId: job.id, details: { removed, kept: kept.length } });
  return upd;
}

export const listImports = (hotelId: string) => db().select().from(importJobs).where(eq(importJobs.hotelId, hotelId)).orderBy(desc(importJobs.createdAt)).limit(20);
export const getImport = (hotelId: string, jobId: string) => ownJob(hotelId, jobId);

// ---------------------------------------------------------------- Rechnungsnummern-Start

export async function invoiceCounter(hotelId: string, year: number): Promise<number> {
  const [r] = rows<{ last: number }>(await db().execute(sql`SELECT last FROM invoice_counters WHERE hotel_id = ${hotelId} AND year = ${year}`));
  return r?.last ?? 0;
}

/** «Nächste Rechnungsnummer» setzen, damit die Reihe der alten Software lückenlos weiterläuft; nie rückwärts (keine Doppel) */
export async function setInvoiceStart(hotel: Hotel, year: number, next: number, actor: string): Promise<void> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ImportError("Jahr ungültig.");
  if (!Number.isInteger(next) || next < 1 || next > 99999) throw new ImportError("Die nächste Nummer muss eine ganze Zahl ab 1 sein.");
  await db().transaction(async (tx) => {
    const [r] = rows<{ last: number }>(await tx.execute(sql`SELECT last FROM invoice_counters WHERE hotel_id = ${hotel.id} AND year = ${year} FOR UPDATE`));
    const last = r?.last ?? 0;
    if (next - 1 < last) throw new ImportError(`Es wurden bereits Rechnungen bis ${year}-${String(last).padStart(4, "0")} ausgestellt. Die nächste Nummer muss mindestens ${last + 1} sein.`);
    await tx.execute(sql`INSERT INTO invoice_counters (hotel_id, year, last) VALUES (${hotel.id}, ${year}, ${next - 1}) ON CONFLICT (hotel_id, year) DO UPDATE SET last = ${next - 1}`);
    await audit(tx, { hotelId: hotel.id, actor, action: "invoice.start_number", entity: "hotel", entityId: hotel.id, details: { year, next } });
  });
}

// ---------------------------------------------------------------- Gesamtexport

/** Alle Daten des Betriebs als CSV je Tabelle; «reservierungen.csv» hat das Import-Schema (zurück oder weiter) */
export async function exportFiles(hotel: Hotel): Promise<{ name: string; csv: string }[]> {
  const id = hotel.id;
  const chf = (r: number) => (r / 100).toFixed(2);
  const types = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, id));
  const plans = await db().select().from(ratePlans).where(eq(ratePlans.hotelId, id));
  const tName = new Map(types.map((t) => [t.id, t.name])), pName = new Map(plans.map((p) => [p.id, p.name]));
  const bs = await db().select({ b: bookings, g: guests }).from(bookings).leftJoin(guests, eq(guests.id, bookings.guestId)).where(eq(bookings.hotelId, id)).orderBy(bookings.checkin);
  const rms = await db().select().from(bookingRooms).where(eq(bookingRooms.hotelId, id));
  const resv: (string | number)[][] = [];
  for (const { b, g } of bs) {
    if (b.status === "hold") continue;
    const room = rms.find((x) => x.bookingId === b.id);
    const bal = await bookingBalance(db(), id, b.id, false);
    resv.push([b.sourceRef ?? b.reference, b.checkin, b.checkout, room ? tName.get(room.roomTypeId) ?? "" : "", room?.ratePlanId ? pName.get(room.ratePlanId) ?? "" : "", b.adults, b.children,
      g?.firstName ?? "", g?.lastName ?? "", g?.email ?? "", g?.phone ?? "", b.language, chf(b.totalRappen), chf(Math.max(0, bal.paidRappen)), b.status === "cancelled" || b.status === "expired" ? "storniert" : "bestaetigt", b.guestNotes ?? ""]);
  }
  const gs = await db().select().from(guests).where(eq(guests.hotelId, id)).orderBy(guests.lastName);
  const inv = await db().select().from(invoices).where(eq(invoices.hotelId, id)).orderBy(invoices.number);
  const vs = await db().select().from(vouchers).where(eq(vouchers.hotelId, id));
  return [
    { name: "reservierungen.csv", csv: toCsv(IMPORT_COLUMNS.map((c) => c.key), resv) },
    { name: "gaeste.csv", csv: toCsv(["vorname", "nachname", "email", "telefon", "sprache", "marketing_einwilligung", "einwilligung_am"], gs.map((g) => [g.firstName, g.lastName, g.email, g.phone, g.language, g.marketingConsent ? "ja" : "nein", g.marketingConsentAt?.toISOString().slice(0, 10)])) },
    { name: "zimmertypen.csv", csv: toCsv(["name", "aktiv"], types.map((t) => [t.name, t.active ? "ja" : "nein"])) },
    { name: "tarife.csv", csv: toCsv(["zimmertyp", "name", "aktiv"], plans.map((p) => [tName.get(p.roomTypeId), p.name, p.active ? "ja" : "nein"])) },
    { name: "rechnungen.csv", csv: toCsv(["nummer", "art", "status", "datum", "faellig", "total", "mwst", "empfaenger"], inv.map((i) => [i.number, i.kind === "credit_note" ? "gutschrift" : "rechnung", i.status === "issued" ? "ausgestellt" : "entwurf", i.issuedOn, i.dueOn, chf(i.totalRappen), chf(i.vatRappen), i.recipient.company || i.recipient.name || ""])) },
    { name: "gutscheine.csv", csv: toCsv(["code", "betrag", "restwert", "status", "kaeufer", "empfaenger"], vs.map((v) => [v.code, chf(v.amountRappen), chf(v.remainingRappen), v.status, v.buyerName, v.recipientName])) },
  ];
}
