"use server";
import { redirect } from "next/navigation";
import { getHotelById } from "@/src/services/hotels";
import { PosError } from "@/src/services/pos";
import { orderAtTable, startTablePayment, submitFeedback, tableBill, tableByQr } from "@/src/services/table-pay";
import { parseCartForm } from "./cart-form";
import { isLocale } from "@/src/i18n/dict";
import { s } from "@/src/lib/form";

const baseOf = (f: FormData) => (/^\/h\/[a-z0-9-]+$/.test(s(f, "base")) ? s(f, "base") : "");

/** Gast bezahlt am Tisch: Auswahl und Trinkgeld lesen, Zahlung starten, zu Stripe weiterleiten */
export async function payTableAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const base = baseOf(f);
  const qr = s(f, "qr");
  const here = (extra: string) => redirect(`${base}/${locale}/am-tisch/${qr}?${extra}`);
  const found = await tableByQr(qr);
  const hotel = found ? await getHotelById(found.hotel.id) : null;
  if (!found || !hotel) redirect(`${base}/${locale}`);
  const selection: { lineId: string; quantity: number }[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("q_")) continue;
    const quantity = Math.floor(Number(v) || 0);
    if (quantity > 0) selection.push({ lineId: k.slice(2), quantity });
  }
  let url: string | null = null;
  let paymentToken = "";
  try {
    const pick = s(f, "tip");
    let tip = 0;
    const bill = await tableBill(found.hotel.id, found.table.id);
    const items = selection.reduce((a, x) => a + x.quantity * (bill.lines.find((l) => l.lineId === x.lineId)?.unitPriceRappen ?? 0), 0);
    if (pick === "custom") tip = Math.round((Number(s(f, "tipCustom").replace(",", ".")) || 0) * 100);
    else if (/^\d{1,2}$/.test(pick)) tip = Math.round((items * Number(pick)) / 100 / 5) * 5; // auf 5 Rappen
    const r = await startTablePayment(hotel, found.table, { orderId: s(f, "orderId"), selection, tipRappen: tip, language: locale, email: s(f, "email") });
    url = r.url;
    paymentToken = r.payment.publicToken;
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    here(`msg=${encodeURIComponent(e.message)}`);
  }
  if (url) redirect(url);
  here(`z=${paymentToken}`);
}

export async function feedbackAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const base = baseOf(f);
  try { await submitFeedback(s(f, "z"), Number(s(f, "stars")), s(f, "comment")); } catch (e) { if (!(e instanceof PosError)) throw e; }
  redirect(`${base}/${locale}/am-tisch/${s(f, "qr")}?z=${encodeURIComponent(s(f, "z"))}`);
}

/** Gast bestellt am Tisch (SPEC 19.61) */
export async function orderTableAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const base = baseOf(f);
  const qr = s(f, "qr");
  const found = await tableByQr(qr);
  const hotel = found ? await getHotelById(found.hotel.id) : null;
  if (!found || !hotel) redirect(`${base}/${locale}`);
  try {
    await orderAtTable(hotel, found.table, parseCartForm(f));
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    redirect(`${base}/${locale}/am-tisch/${qr}?msg=${encodeURIComponent(e.message)}`);
  }
  redirect(`${base}/${locale}/am-tisch/${qr}?bestellt=1`);
}
