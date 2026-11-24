"use server";

import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { AccessError, issueCodes, revokeCodes } from "@/src/services/door-access";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>, bookingId: string) => Promise<string>) {
  const hotelId = s(f, "hotelId"), bookingId = s(f, "bookingId");
  const c = await requireHotelModule("access", hotelId, "staff", "bookings");
  let msg: string;
  try { msg = await fn(c, bookingId); } catch (e) { if (!(e instanceof AccessError)) throw e; msg = e.message; }
  redirect(`/admin/${hotelId}/bookings/${bookingId}?msg=${encodeURIComponent(msg)}#zutritt`);
}
export async function issueAction(f: FormData) {
  await run(f, async (c, id) => { const r = await issueCodes(c.hotel, id, c.actor); return r.errors ? `${r.errors} Code(s) fehlgeschlagen, siehe Liste.` : "Zutrittscodes erstellt."; });
}
export async function revokeAction(f: FormData) {
  await run(f, async (c, id) => `${await revokeCodes(c.hotel, id, c.actor)} Code(s) zurückgezogen.`);
}
