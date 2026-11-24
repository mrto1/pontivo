import { and, asc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { ratePlans, roomTypes, type Hotel } from "@/src/db/schema";
import { addDays, todayIn } from "@/src/domain/dates";
import { LOCALES } from "@/src/i18n/dict";

const LANG_NAMES: Record<string, string> = { de: "Deutsch", en: "Englisch", fr: "Französisch", it: "Italienisch", nl: "Niederländisch" };

/** Formular «Buchung erfassen» (Telefon, E-Mail, Empfang); `sp` füllt die Felder nach einem Fehler wieder aus. Läuft in der Seitenleiste der Buchungsliste. */
export async function NewBookingForm({ hotel, sp, action, cancelHref }: { hotel: Hotel; sp: Record<string, string | undefined>; action: (f: FormData) => Promise<void>; cancelHref: string }) {
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder));
  const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true))).orderBy(asc(ratePlans.createdAt));
  const today = todayIn(hotel.timezone);
  const checkin = sp.checkin ?? today;
  return (
  <form action={action} className="stack">
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
      <div><label>Erwachsene</label><input type="number" name="adults" min={1} max={30} required defaultValue={sp.adults ?? 2} className="w80" /></div>
      <div><label>Kinder</label><input type="number" name="children" min={0} max={20} defaultValue={sp.children ?? 0} className="w80" /></div>
      <div><label>Alter der Kinder</label><input name="ages" placeholder="z. B. 4, 9" defaultValue={sp.ages} style={{ width: 120 }} /></div>
    </div>
    {[2, 3].map((i) => (
      <details key={i} open={!!sp[`offer${i}`]}>
        <summary className="small">Weiteres Zimmer {i - 1} hinzufügen (z. B. Familie, mehrere Zimmer)</summary>
        <div className="inline-form">
          <div>
            <label>Zimmer und Tarif</label>
            <select name={`offer${i}`} defaultValue={sp[`offer${i}`] ?? ""}>
              <option value="">(kein weiteres Zimmer)</option>
              {rts.map((rt) => rps.filter((p) => p.roomTypeId === rt.id).map((p) => <option key={p.id} value={`${rt.id}|${p.id}`}>{rt.name} · {p.name}</option>))}
            </select>
          </div>
          <div><label>Erwachsene</label><input type="number" name={`adults${i}`} min={1} max={30} defaultValue={sp[`adults${i}`] ?? 2} className="w80" /></div>
          <div><label>Kinder</label><input type="number" name={`children${i}`} min={0} max={20} defaultValue={sp[`children${i}`] ?? 0} className="w80" /></div>
          <div><label>Alter der Kinder</label><input name={`ages${i}`} placeholder="z. B. 4, 9" defaultValue={sp[`ages${i}`]} style={{ width: 120 }} /></div>
        </div>
      </details>
    ))}
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
    <div className="drawer-actions"><button className="btn">Buchung erfassen</button><a className="btn secondary" href={cancelHref}>Abbrechen</a></div>
  </form>
  );
}
