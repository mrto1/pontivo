import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { resolvePublicHotel } from "@/src/services/hotels";
import { chatLocale, handleChat } from "@/src/services/chat";
import { CHAT_TEXT } from "@/src/i18n/chat";

export const dynamic = "force-dynamic";

/** KI-Chat (SPEC 14b). Body: { hotel, session?, messages, lang, surface }. Antwort: { status, reply?, session?, forward? } */
export async function POST(req: Request) {
  let b: { hotel?: string; session?: string | null; messages?: unknown; lang?: string; surface?: string };
  try {
    b = await req.json();
  } catch {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
  const hotel = await resolvePublicHotel(req.headers.get("host"), b.hotel ?? null);
  if (!hotel) return Response.json({ status: "off" }, { status: 404 });
  const lang = chatLocale(hotel, String(b.lang ?? "de"));
  // Rate-Limit pro IP und zusätzlich pro Hotel (gegen Bots mit wechselnden Adressen)
  if (!rateLimit(`chat:${hotel.id}:${clientIp(req)}`, 12) || !rateLimit(`chat-hotel:${hotel.id}`, 200)) {
    return Response.json({ status: "error", reply: CHAT_TEXT[lang].error }, { status: 429 });
  }
  const out = await handleChat(hotel, { session: b.session ?? null, messages: b.messages, lang, surface: b.surface === "booking" ? "booking" : "site" });
  if (out.status === "off") return Response.json({ status: "off" }, { status: 404 });
  if (out.status === "invalid") return Response.json(out, { status: 400 });
  return Response.json(out, { status: out.status === "error" ? 502 : 200 });
}
