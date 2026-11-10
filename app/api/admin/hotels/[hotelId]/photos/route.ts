import { cookies } from "next/headers";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { addPhoto, RoomError } from "@/src/services/rooms";
import { setLogo } from "@/src/services/brand";
import { deleteImage, saveImage, UploadError, MAX_UPLOAD_BYTES } from "@/src/lib/storage";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** Foto-Upload (Formular mit enctype=multipart/form-data), danach zurück zur Zimmer-Seite */
export async function POST(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "manager")) return new Response("Not found", { status: 404 });
  const fromWizard = new URL(req.url).searchParams.get("from") === "wizard";
  const back = (msg: string, anchor = "") =>
    Response.redirect(fromWizard
      ? `${env().APP_BASE_URL}/admin/${hotelId}/einrichten?step=fotos&msg=${encodeURIComponent(msg)}`
      : `${env().APP_BASE_URL}/admin/${hotelId}/rooms?msg=${encodeURIComponent(msg)}${anchor}`, 303);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES * 3 + 100_000) return back("Zu grosse Datei(en)");
  const form = await req.formData();
  const roomTypeId = String(form.get("roomTypeId") ?? "") || null;
  if (form.get("target") === "logo") {
    const f = form.get("file");
    const toEmbed = (msg: string) => Response.redirect(`${env().APP_BASE_URL}/admin/${hotelId}/embed?msg=${encodeURIComponent(msg)}`, 303);
    if (!(f instanceof File) || f.size === 0) return toEmbed("Keine Datei ausgewählt");
    try {
      const url = await saveImage(hotelId, new Uint8Array(await f.arrayBuffer()));
      const old = await setLogo(hotelId, url, `user:${userId}`);
      if (old) await deleteImage(old);
      return toEmbed("Logo gespeichert");
    } catch (e) {
      if (e instanceof UploadError) return toEmbed(`Logo: ${e.message}`);
      throw e;
    }
  }
  const alt = String(form.get("alt") ?? "").trim().slice(0, 200) || undefined;
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 3);
  if (!files.length) return back("Keine Datei ausgewählt");
  let added = 0;
  for (const f of files) {
    let url: string | null = null;
    try {
      url = await saveImage(hotelId, new Uint8Array(await f.arrayBuffer()));
      await addPhoto(hotelId, roomTypeId, { url, alt }, `user:${userId}`);
      added++;
    } catch (e) {
      if (url) await deleteImage(url);
      if (e instanceof UploadError || e instanceof RoomError) return back(`${f.name}: ${e.message}`);
      throw e;
    }
  }
  return back(`${added} Foto(s) hochgeladen`, roomTypeId ? `#rt-${roomTypeId}` : "#hotel-photos");
}
