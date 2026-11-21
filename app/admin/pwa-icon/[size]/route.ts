import { PWA_ICONS } from "@/src/pwa/icons.generated";

export const dynamic = "force-static";
export function generateStaticParams() {
  return Object.keys(PWA_ICONS).map((size) => ({ size }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const b64 = PWA_ICONS[size];
  if (!b64) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(b64, "base64"), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
