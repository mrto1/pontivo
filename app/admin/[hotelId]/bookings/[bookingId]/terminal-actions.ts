"use server";

import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { InvoiceError } from "@/src/services/invoicing";
import { cancelTerminalPayment, checkTerminalPayment, startTerminalPayment } from "@/src/services/terminal";
import { decimalToRappen } from "@/src/domain/money";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>, bookingId: string) => Promise<string>) {
  const hotelId = s(f, "hotelId"), bookingId = s(f, "bookingId");
  const c = await requireHotel(hotelId, "staff", "bookings");
  await requireModule(c.hotel.id, "terminal");
  let msg: string;
  try { msg = await fn(c, bookingId); } catch (e) { if (!(e instanceof InvoiceError)) throw e; msg = e.message; }
  redirect(`/admin/${hotelId}/bookings/${bookingId}?msg=${encodeURIComponent(msg)}#kasse`);
}

export async function terminalStartAction(f: FormData) {
  await run(f, async (c, bookingId) => {
    await startTerminalPayment(c.hotel, bookingId, s(f, "readerId"), decimalToRappen(s(f, "amount").replace(",", ".").replace(/[^\d.]/g, "") || "0"), c.actor);
    return "Zahlung am Kartenleser gestartet. Karte jetzt am Gerät vorlegen, danach «Status prüfen».";
  });
}
export async function terminalCheckAction(f: FormData) {
  await run(f, (c) => checkTerminalPayment(c.hotel, s(f, "tpId")));
}
export async function terminalCancelAction(f: FormData) {
  await run(f, async (c) => { await cancelTerminalPayment(c.hotel, s(f, "tpId"), c.actor); return "Zahlung abgebrochen."; });
}
