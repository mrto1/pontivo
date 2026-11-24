import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { GuestNoteError, MAX_NOTE, profileOf, saveProfile } from "@/src/services/guest-notes";

async function save(f: FormData) {
  "use server";
  const hotelId = String(f.get("hotelId")), bookingId = String(f.get("bookingId")), email = String(f.get("email"));
  const c = await requireHotelModule("guestnotes", hotelId, "staff", "bookings");
  let msg = "Notiz gespeichert.";
  try { await saveProfile(c.hotel.id, email, { note: String(f.get("note") ?? ""), tags: String(f.get("tags") ?? "") }, c.actor); } catch (e) { if (!(e instanceof GuestNoteError)) throw e; msg = e.message; }
  redirect(`/admin/${c.hotel.id}/bookings/${bookingId}?note=${encodeURIComponent(msg)}#gastnotiz`);
}

/** Notiz und Tags zum Gast (SPEC 17.2) auf der Buchung */
export async function GuestNoteCard({ hotelId, bookingId, email, msg }: { hotelId: string; bookingId: string; email: string | null; msg?: string }) {
  if (!email) return null;
  const p = await profileOf(hotelId, email);
  return (
    <section className="card stack" id="gastnotiz">
      <h3 className="m0">Notiz zum Gast</h3>
      {msg ? <p className="notice small">{msg}</p> : null}
      <form action={save} className="stack">
        <input type="hidden" name="hotelId" value={hotelId} /><input type="hidden" name="bookingId" value={bookingId} /><input type="hidden" name="email" value={email} />
        <div><label htmlFor="f8cd91">Tags (mit Komma trennen)</label><input id="f8cd91" name="tags" defaultValue={(p?.tags ?? []).join(", ")} placeholder="Stammgast, VIP" /></div>
        <div><label htmlFor="f8cd92">Notiz (nur intern)</label><textarea id="f8cd92" name="note" rows={3} maxLength={MAX_NOTE} defaultValue={p?.note ?? ""} placeholder="z. B. mag ruhiges Zimmer oben" /></div>
        <p className="small muted">Gilt für diese E-Mail-Adresse bei allen Buchungen. Bitte keine Gesundheitsangaben oder andere heikle Daten notieren.</p>
        <div><button className="btn secondary small">Speichern</button></div>
      </form>
    </section>
  );
}
