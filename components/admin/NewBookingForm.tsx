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
      <label htmlFor="nb-of">Zimmer und Tarif</label>
      <select id="nb-of" name="offer" required defaultValue={sp.offer}>
        {rts.map((rt) => rps.filter((p) => p.roomTypeId === rt.id).map((p) => (
          <option key={p.id} value={`${rt.id}|${p.id}`}>{rt.name} · {p.name}</option>
        )))}
      </select>
    </div>
    <div className="form-grid">
      <div><label htmlFor="nb-in">Anreise</label><input id="nb-in" type="date" name="checkin" required min={today} defaultValue={checkin} /></div>
      <div><label htmlFor="nb-out">Abreise</label><input id="nb-out" type="date" name="checkout" required min={addDays(today, 1)} defaultValue={sp.checkout ?? addDays(checkin, 1)} /></div>
    </div>
    <div className="form-grid tight">
      <div><label htmlFor="nb-ad">Erwachsene</label><input id="nb-ad" type="number" name="adults" min={1} max={30} required defaultValue={sp.adults ?? 2} /></div>
      <div><label htmlFor="nb-ch">Kinder</label><input id="nb-ch" type="number" name="children" min={0} max={20} defaultValue={sp.children ?? 0} /></div>
      <div><label htmlFor="nb-ag">Alter der Kinder</label><input id="nb-ag" name="ages" placeholder="z. B. 4, 9" defaultValue={sp.ages} /></div>
    </div>
    {[2, 3].map((i) => (
      <details key={i} open={!!sp[`offer${i}`]}>
        <summary className="small">Weiteres Zimmer {i - 1} hinzufügen (z. B. Familie, mehrere Zimmer)</summary>
        <div className="stack mt8">
          <div>
            <label htmlFor={`nb-of${i}`}>Zimmer und Tarif</label>
            <select id={`nb-of${i}`} name={`offer${i}`} defaultValue={sp[`offer${i}`] ?? ""}>
              <option value="">(kein weiteres Zimmer)</option>
              {rts.map((rt) => rps.filter((p) => p.roomTypeId === rt.id).map((p) => <option key={p.id} value={`${rt.id}|${p.id}`}>{rt.name} · {p.name}</option>))}
            </select>
          </div>
          <div className="form-grid tight">
            <div><label htmlFor={`nb-ad${i}`}>Erwachsene</label><input id={`nb-ad${i}`} type="number" name={`adults${i}`} min={1} max={30} defaultValue={sp[`adults${i}`] ?? 2} /></div>
            <div><label htmlFor={`nb-ch${i}`}>Kinder</label><input id={`nb-ch${i}`} type="number" name={`children${i}`} min={0} max={20} defaultValue={sp[`children${i}`] ?? 0} /></div>
            <div><label htmlFor={`nb-ag${i}`}>Alter der Kinder</label><input id={`nb-ag${i}`} name={`ages${i}`} placeholder="z. B. 4, 9" defaultValue={sp[`ages${i}`]} /></div>
          </div>
        </div>
      </details>
    ))}
    <div className="form-grid">
      <div><label htmlFor="nb-fn">Vorname</label><input id="nb-fn" name="firstName" required maxLength={100} autoComplete="off" defaultValue={sp.firstName} /></div>
      <div><label htmlFor="nb-ln">Nachname</label><input id="nb-ln" name="lastName" required maxLength={100} autoComplete="off" defaultValue={sp.lastName} /></div>
      <div><label htmlFor="nb-em">E-Mail (optional)</label><input id="nb-em" type="email" name="email" maxLength={200} autoComplete="off" defaultValue={sp.email} /></div>
      <div><label htmlFor="nb-ph">Telefon (optional)</label><input id="nb-ph" type="tel" name="phone" maxLength={40} autoComplete="off" defaultValue={sp.phone} /></div>
      <div>
        <label htmlFor="nb-lang">Sprache</label>
        <select id="nb-lang" name="language" defaultValue={sp.language ?? hotel.defaultLanguage}>{LOCALES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</select>
      </div>
    </div>
    <div><label htmlFor="nb-no">Bemerkung</label><textarea id="nb-no" name="notes" rows={2} maxLength={2000} defaultValue={sp.notes} /></div>
    <label className="check"><input type="checkbox" name="notify" defaultChecked /> Bestätigung per E-Mail an den Gast (falls E-Mail angegeben)</label>
    <div className="drawer-actions"><button className="btn">Buchung erfassen</button><a className="btn secondary" href={cancelHref}>Abbrechen</a></div>
  </form>
  );
}
