import { MAX_PHOTOS } from "@/src/services/rooms";
import { photoAction } from "@/app/admin/[hotelId]/photo-actions";
import { PhotoGrid } from "./PhotoGrid";

/** Fotos verwalten (Hotel oder Zimmertyp): Raster mit Sortieren und ✕, darunter das Hochladen. `page` = Seite, auf der zurückgekehrt wird. */
export function PhotoManager({ hotelId, roomTypeId, photos, canEdit, page, alt }: { hotelId: string; roomTypeId: string | null; photos: { url: string; alt?: string }[]; canEdit: boolean; page: "rooms" | "site" | "einrichten"; alt: string }) {
  return (
    <div className="stack">
      {photos.length ? (
        <PhotoGrid key={photos.map((p) => p.url).join("|")} photos={photos} canEdit={canEdit} action={photoAction} hidden={{ hotelId, roomTypeId: roomTypeId ?? "", page }} />
      ) : (
        <p className="muted small">Noch keine Fotos.</p>
      )}
      {canEdit && photos.length < MAX_PHOTOS ? (
        <form action={`/api/admin/hotels/${hotelId}/photos?from=${page}`} method="post" encType="multipart/form-data" className="inline-form">
          <input type="hidden" name="roomTypeId" value={roomTypeId ?? ""} />
          <div className="dropzone" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`ph-file-${roomTypeId ?? "haus"}`}>Fotos hochladen (JPG, PNG, WebP, max. 8 MB, bis 3 aufs Mal)</label>
            <input id={`ph-file-${roomTypeId ?? "haus"}`} type="file" name="file" accept="image/jpeg,image/png,image/webp" multiple required />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label htmlFor={`ph-alt-${roomTypeId ?? "haus"}`}>Bildbeschreibung (optional)</label>
            <input id={`ph-alt-${roomTypeId ?? "haus"}`} name="alt" placeholder={alt} />
          </div>
          <button className="btn small">Hochladen</button>
        </form>
      ) : null}
    </div>
  );
}
