import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { db } from "@/src/db/client";
import { ratePlans, roomTypes } from "@/src/db/schema";
import { bookingErrorText, createAdminBooking } from "@/src/services/admin-bookings";
import { BookingError } from "@/src/services/bookings";
import { addDays, todayIn } from "@/src/domain/dates";
import { LOCALES } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const LANG_NAMES: Record<string, string> = { de: "Deutsch", en: "Englisch", fr: "Französisch", it: "Italienisch", nl: "Niederländisch" };

async function createAction(formData: FormData) {
  "use server";
  const hotelId = String(formData.get("hotelId"));
  const { hotel, actor } = await requireHotel(hotelId, "staff");
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const [roomTypeId, ratePlanId] = s("offer").split("|");
  const children = Number(s("children") || 0);
  const ages = s("ages") ? s("ages").split(/[,;\s]+/).filter(Boolean).map(Number) : [];
  let target = "";
  try {
    const b = await createAdminBooking(hotel, {
      roomTypeId, ratePlanId, checkin: s("checkin"), checkout: s("checkout"), adults: Number(s("adults") || 1), children, childrenAges: ages,
      guest: { firstName: s("firstName"), lastName: s("lastName"), email: s("email"), phone: s("phone") || undefined, language: (s("language") || "de") as "de", notes: s("notes") || undefined },
      notifyGuest: formData.get("notify") === "on",
    }, actor);
    target = `/admin/${hotelId}/bookings/${b.id}?msg=${encodeURIComponent("Buchung erfasst")}`;
  } catch (e) {
    const msg = e instanceof BookingError ? bookingErrorText(e.code) : e instanceof ZodError ? e.issues.map((i) => i.message).join(", ") : `Fehler: ${(e as Error).message}`;
    const keep = new URLSearchParams();
    for (const k of ["offer", "checkin", "checkout", "adults", "children", "ages", "firstName", "lastName", "email", "phone", "language", "notes"]) if (s(k)) keep.set(k, s(k));
    keep.set("msg", msg);
    target = `/admin/${hotelId}/bookings/new?${keep}`;
  }
  redirect(target);
}

export default async function NewBooking({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff");
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder));
  const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true))).orderBy(asc(ratePlans.createdAt));
  const today = todayIn(hotel.timezone);
  const checkin = sp.checkin ?? today;

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <a href={`/admin/${hotel.id}/bookings`}>← Buchungen</a>
      <h1>Buchung erfassen</h1>
      <p className="muted">Für Buchungen per Telefon, E-Mail oder am Empfang. Der Gast bezahlt vor Ort; Preis und Kurtaxe kommen aus dem Kalender. Die Verfügbarkeit wird sofort an die Buchungsportale gemeldet.</p>
      {sp.msg ? <p className="notice warn">{sp.msg}</p> : null}
      <form action={createAction} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <div>
          <label>Zimmer und Tarif</label>
          <select name="offer" required defaultValue={sp.offer}>
            {rts.map((rt) => rps.filter((p) => p.roomTypeId === rt.id).map((p) => (
              <option key={p.id} value={`${rt.id}|${p.id}`}>{rt.name} · {p.name}</option>
            )))}
          </select>
        </div>
        <div className="inline-form">
          <div><label>Anreise</label><input type="date" name="checkin" required min={today} defaultValue={checkin} /></div>
          <div><label>Abreise</label><input type="date" name="checkout" required min={addDays(today, 1)} defaultValue={sp.checkout ?? addDays(checkin, 1)} /></div>
          <div><label>Erwachsene</label><input type="number" name="adults" min={1} max={30} required defaultValue={sp.adults ?? 2} style={{ width: 80 }} /></div>
          <div><label>Kinder</label><input type="number" name="children" min={0} max={20} defaultValue={sp.children ?? 0} style={{ width: 80 }} /></div>
          <div><label>Alter der Kinder</label><input name="ages" placeholder="z. B. 4, 9" defaultValue={sp.ages} style={{ width: 120 }} /></div>
        </div>
        <div className="inline-form">
          <div><label>Vorname</label><input name="firstName" required maxLength={100} defaultValue={sp.firstName} /></div>
          <div><label>Nachname</label><input name="lastName" required maxLength={100} defaultValue={sp.lastName} /></div>
        </div>
        <div className="inline-form">
          <div><label>E-Mail (optional)</label><input type="email" name="email" maxLength={200} defaultValue={sp.email} /></div>
          <div><label>Telefon (optional)</label><input type="tel" name="phone" maxLength={40} defaultValue={sp.phone} /></div>
          <div>
            <label>Sprache</label>
            <select name="language" defaultValue={sp.language ?? hotel.defaultLanguage}>{LOCALES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</select>
          </div>
        </div>
        <div><label>Bemerkung</label><textarea name="notes" rows={2} maxLength={2000} defaultValue={sp.notes} /></div>
        <label className="check"><input type="checkbox" name="notify" defaultChecked /> Bestätigung per E-Mail an den Gast (falls E-Mail angegeben)</label>
        <button className="btn">Buchung erfassen</button>
      </form>
    </div>
  );
}
