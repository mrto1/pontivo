"use server";
import { redirect } from "next/navigation";
import { getHotelById } from "@/src/services/hotels";
import { PosError } from "@/src/services/pos";
import { createOnlineOrder, type CartLine } from "@/src/services/online-orders";
import { isLocale } from "@/src/i18n/dict";
import { s } from "@/src/lib/form";

const baseOf = (f: FormData) => (/^\/h\/[a-z0-9-]+$/.test(s(f, "base")) ? s(f, "base") : "");
const UUID = /^[0-9a-f-]{36}$/i;

/** Warenkorb aus dem Browser: nur Form prüfen, Preise und Optionen rechnet der Dienst neu */
export async function parseCart(raw: string): Promise<CartLine[] | null> {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: CartLine[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const l = x as Record<string, unknown>;
    if (typeof l.itemId !== "string" || !UUID.test(l.itemId)) return null;
    if (!Array.isArray(l.optionIds) || l.optionIds.length > 30 || !l.optionIds.every((o) => typeof o === "string" && UUID.test(o))) return null;
    out.push({ itemId: l.itemId, quantity: Number(l.quantity), optionIds: l.optionIds as string[], note: typeof l.note === "string" ? l.note.slice(0, 200) : "" });
  }
  return out;
}

/** Gast bestellt (öffentliches Formular, SPEC 20.4). Karte → Stripe Checkout, bar → Statusseite. */
export async function orderAction(f: FormData) {
  const locale = isLocale(s(f, "locale")) ? s(f, "locale") : "de";
  const base = baseOf(f);
  const hotel = await getHotelById(s(f, "hotelId"));
  if (!hotel) redirect("/");
  if (s(f, "website")) redirect(`${base}/${locale}`); // Honigtopf gegen Bots
  const back = (msg: string): never => redirect(`${base}/${locale}/bestellen?msg=${encodeURIComponent(msg)}`);
  const lines = await parseCart(s(f, "cart"));
  if (!lines) back("Der Warenkorb ist ungültig.");
  const kind = s(f, "kind") === "delivery" ? "delivery" : "pickup";
  let token = "", go = "";
  try {
    const r = await createOnlineOrder(hotel, {
      kind, time: s(f, "time") || "asap", payment: s(f, "payment") === "cash" ? "cash" : "card", name: s(f, "name"), phone: s(f, "phone"), email: s(f, "email"), note: s(f, "note"), language: locale, lines: lines!,
      address: kind === "delivery" ? { street: s(f, "street"), houseNo: s(f, "houseNo"), postalCode: s(f, "postalCode"), city: s(f, "city"), floor: s(f, "floor"), bell: s(f, "bell"), hint: s(f, "hint") } : undefined,
    });
    token = r.order.publicToken;
    go = r.checkoutUrl ?? "";
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    back(e.message);
  }
  if (go) redirect(go); // Zahlungsseite von Stripe
  redirect(`${base}/${locale}/bestellung/${token}?neu=1`);
}
