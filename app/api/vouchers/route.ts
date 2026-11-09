import { ZodError } from "zod";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { resolvePublicHotel } from "@/src/services/hotels";
import { buyVoucher, VoucherError } from "@/src/services/vouchers";
import { decimalToRappen } from "@/src/domain/money";
import { safeBack } from "@/src/lib/back";

export const dynamic = "force-dynamic";

/** Gutschein kaufen: Formular der Hotel-Website → Zahlungsseite */
export async function POST(req: Request) {
  const form = await req.formData();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const back = safeBack(s("back"));
  const fail = () => Response.redirect(new URL(`${back}#gutschein-fehler`, req.url), 303);
  if (s("website")) return fail();
  if (!rateLimit(`voucher:${clientIp(req)}`, 5)) return fail();
  const hotel = await resolvePublicHotel(req.headers.get("host"), s("hotel"));
  if (!hotel) return new Response("Not found", { status: 404 });
  let amount: number;
  try {
    amount = s("amount") === "other" ? decimalToRappen(s("other")) : Number(s("amount"));
  } catch {
    return fail();
  }
  try {
    const { checkoutUrl } = await buyVoucher(hotel, {
      amountRappen: amount, buyerName: s("buyerName"), buyerEmail: s("buyerEmail"), recipientName: s("recipientName"), message: s("message"), language: s("lang") || "de",
    });
    return Response.redirect(checkoutUrl, 303);
  } catch (e) {
    if (e instanceof ZodError || e instanceof VoucherError) return fail();
    throw e;
  }
}
