import { ZodError } from "zod";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { resolvePublicHotel } from "@/src/services/hotels";
import { aiChatActive } from "@/src/services/ai-module";
import { chatLocale } from "@/src/services/chat";
import { createInquiry } from "@/src/services/inquiries";

export const dynamic = "force-dynamic";

/** Frage aus dem KI-Chat ans Hotel weiterleiten: wird eine normale Anfrage (mit Push und Mail). Body: { hotel, name, email, transcript, lang } */
export async function POST(req: Request) {
  let b: { hotel?: string; name?: string; email?: string; transcript?: unknown; lang?: string };
  try {
    b = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const hotel = await resolvePublicHotel(req.headers.get("host"), b.hotel ?? null);
  if (!hotel) return Response.json({ ok: false }, { status: 404 });
  if (!rateLimit(`chat-forward:${clientIp(req)}`, 5)) return Response.json({ ok: false }, { status: 429 });
  if (!(await aiChatActive(hotel)).active) return Response.json({ ok: false }, { status: 404 });
  const lines = Array.isArray(b.transcript) ? b.transcript : [];
  const text = lines
    .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string")
    .map((m) => `${m.role === "user" ? "Gast" : "Assistent"}: ${m.content.slice(0, 600)}`)
    .join("\n");
  // Die Anfrage nimmt höchstens 4000 Zeichen auf: der jüngste Teil des Verlaufs ist der wichtigste
  const message = `Frage aus dem KI-Chat der Website:\n${text}`.slice(-3900);
  try {
    await createInquiry(hotel, { kind: "other", name: String(b.name ?? ""), email: String(b.email ?? ""), message, language: chatLocale(hotel, String(b.lang ?? "de")), pageSlug: "chat" });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ ok: false }, { status: 400 });
    throw e;
  }
}
