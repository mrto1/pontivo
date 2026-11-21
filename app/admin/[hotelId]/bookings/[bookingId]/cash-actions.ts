"use server";

import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { addFolioItem, createInvoiceDraft, deleteFolioItem, InvoiceError, recordOnsitePayment } from "@/src/services/invoicing";
import { decimalToRappen } from "@/src/domain/money";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function run(f: FormData, min: "staff" | "manager", fn: (c: Awaited<ReturnType<typeof requireHotel>>, bookingId: string) => Promise<string | { to: string }>) {
  const hotelId = s(f, "hotelId"), bookingId = s(f, "bookingId");
  const c = await requireHotel(hotelId, min, "bookings");
  await requireModule(c.hotel.id, "invoicing");
  let out: string | { to: string };
  try {
    out = await fn(c, bookingId);
  } catch (e) {
    if (!(e instanceof InvoiceError)) throw e;
    out = `Nicht gespeichert: ${e.message}`;
  }
  if (typeof out !== "string") redirect(out.to);
  redirect(`/admin/${hotelId}/bookings/${bookingId}?msg=${encodeURIComponent(out)}#kasse`);
}

/** Betrag mit Komma oder Punkt, optional negativ */
function amount(v: string): number {
  const t = v.replace(",", ".").replace(/[^\d.\-]/g, "");
  const neg = t.startsWith("-");
  const r = decimalToRappen(t.replace("-", "") || "0");
  return neg ? -r : r;
}

export async function addFolioAction(f: FormData) {
  await run(f, "staff", async (c, bookingId) => {
    await addFolioItem(c.hotel.id, bookingId, { description: s(f, "description"), quantity: Number(s(f, "quantity")) || 1, unitPriceRappen: amount(s(f, "price")), vatKind: s(f, "vatKind") as "stay" | "standard" | "none" }, c.actor);
    return "Posten gespeichert.";
  });
}

export async function deleteFolioAction(f: FormData) {
  await run(f, "staff", async (c) => {
    await deleteFolioItem(c.hotel.id, s(f, "itemId"), c.actor);
    return "Posten gelöscht.";
  });
}

export async function onsitePaymentAction(f: FormData) {
  await run(f, "staff", async (c, bookingId) => {
    await recordOnsitePayment(c.hotel, bookingId, { amountRappen: amount(s(f, "amount")), method: s(f, "method") as "cash", note: s(f, "note"), receivedOn: s(f, "date") || undefined }, c.actor);
    return "Zahlung verbucht.";
  });
}

export async function draftAction(f: FormData) {
  await run(f, "staff", async (c, bookingId) => {
    const inv = await createInvoiceDraft(c.hotel, bookingId, c.actor);
    return { to: `/admin/${c.hotel.id}/invoices/${inv.id}` };
  });
}
