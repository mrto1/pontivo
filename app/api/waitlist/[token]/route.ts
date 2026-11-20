import { cancelWaitlistByToken } from "@/src/services/direct-tools";
import { isLocale } from "@/src/i18n/dict";
import { D } from "@/src/i18n/direct";

export const dynamic = "force-dynamic";

/** Abmelden von der Warteliste über den Link in der Mail (ohne Anmeldung); wiederholbar */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? await cancelWaitlistByToken(token) : null;
  if (!r) return new Response("Not found", { status: 404 });
  const m = D[isLocale(r.language) ? r.language : "de"];
  const html = `<!doctype html><html lang="${r.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${m.waitCancelled}</title></head><body style="font-family:Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#1f2a2e"><h1 style="font-size:20px">${m.waitCancelled}</h1><p>${m.waitCancelledNote}</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
}
