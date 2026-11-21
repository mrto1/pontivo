"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireHotel } from "@/src/auth/guard";
import { changePhoto, reorderPhotos, RoomError } from "@/src/services/rooms";
import { deleteImage } from "@/src/lib/storage";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const PAGE = { rooms: (id: string) => `/admin/${id}/rooms?`, site: (id: string) => `/admin/${id}/site?`, einrichten: (id: string) => `/admin/${id}/einrichten?step=fotos&` } as const;

/** Foto entfernen oder Reihenfolge speichern (das erste Foto ist das Titelbild). Danach zurück auf die Seite, von der das Formular kam. */
export async function photoAction(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  const roomTypeId = s(f, "roomTypeId") || null;
  const page = s(f, "page") in PAGE ? (s(f, "page") as keyof typeof PAGE) : "rooms";
  const action = s(f, "action");
  let msg: string;
  try {
    if (action === "remove") {
      await changePhoto(c.hotel.id, roomTypeId, s(f, "url"), "remove", c.actor);
      await deleteImage(s(f, "url"));
      msg = "Foto entfernt";
    } else if (action === "order") {
      const urls: unknown = JSON.parse(s(f, "order") || "[]");
      if (!Array.isArray(urls) || urls.some((u) => typeof u !== "string")) throw new RoomError("Ungültige Reihenfolge");
      await reorderPhotos(c.hotel.id, roomTypeId, urls as string[], c.actor);
      msg = "Reihenfolge gespeichert";
    } else {
      throw new RoomError("Unbekannte Aktion");
    }
  } catch (e) {
    msg = `Nicht gespeichert: ${e instanceof RoomError ? e.message : "Fehler"}`;
  }
  revalidatePath(`/admin/${c.hotel.id}/${page === "einrichten" ? "einrichten" : page}`);
  // Zimmer-Seite: zurück in die Seitenleiste des Zimmertyps (Reiter Fotos)
  const drawer = page === "rooms" && roomTypeId ? `rt=${roomTypeId}&tab=fotos&` : "";
  redirect(`${PAGE[page](c.hotel.id)}${drawer}msg=${encodeURIComponent(msg)}${page === "einrichten" || page === "rooms" ? "" : "#hotel-photos"}`);
}
