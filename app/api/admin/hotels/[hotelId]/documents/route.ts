import { cookies } from "next/headers";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { addDocument, SiteError } from "@/src/services/site";
import { deleteImage, savePdf, UploadError, MAX_PDF_BYTES } from "@/src/lib/storage";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** PDF-Upload für die Dokument-Bibliothek (Formular multipart/form-data), danach zurück zu Website → Dokumente */
export async function POST(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "manager")) return new Response("Not found", { status: 404 });
  const back = (msg: string) => Response.redirect(`${env().APP_BASE_URL}/admin/${hotelId}/site?msg=${encodeURIComponent(msg)}#dokumente`, 303);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_PDF_BYTES + 100_000) return back(`Nicht möglich: Datei zu gross (max. ${MAX_PDF_BYTES / 1024 / 1024} MB)`);
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return back("Nicht möglich: Keine Datei ausgewählt");
  const title = { de: String(form.get("title.de") ?? ""), en: String(form.get("title.en") ?? "") };
  if (!title.de.trim() && !title.en.trim()) title.de = f.name.replace(/\.pdf$/i, "").slice(0, 120);
  let url: string | null = null;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    url = await savePdf(hotelId, bytes);
    await addDocument(hotelId, { url, title, bytes: bytes.length }, `user:${userId}`);
    return back("Dokument hochgeladen");
  } catch (e) {
    if (url) await deleteImage(url);
    if (e instanceof UploadError || e instanceof SiteError) return back(`Nicht möglich: ${e.message}`);
    throw e;
  }
}
