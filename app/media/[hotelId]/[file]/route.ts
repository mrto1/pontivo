import fs from "node:fs/promises";
import { mediaPath } from "@/src/lib/storage";

export const dynamic = "force-dynamic";

/** Hochgeladene Fotos und PDFs ausliefern */
export async function GET(_req: Request, ctx: { params: Promise<{ hotelId: string; file: string }> }) {
  const { hotelId, file } = await ctx.params;
  const p = mediaPath(hotelId, file);
  if (!p) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(p.file);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": p.type,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        ...(p.type === "application/pdf" ? { "content-disposition": "inline" } : {}),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
