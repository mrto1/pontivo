import { bookingBalance } from "@/src/services/invoicing";
import { listReaders, listTerminalPayments } from "@/src/services/terminal";
import { db } from "@/src/db/client";
import { formatChf } from "@/src/domain/money";
import type { Hotel } from "@/src/db/schema";
import { terminalCancelAction, terminalCheckAction, terminalStartAction } from "./terminal-actions";

const STATUS: Record<string, string> = { pending: "läuft am Gerät", succeeded: "bezahlt", failed: "fehlgeschlagen", canceled: "abgebrochen" };

/** Kartenzahlung am Terminal, Teil von «Rechnung & Kasse» (Modul «Kartenterminal») */
export async function TerminalCard({ hotel, bookingId }: { hotel: Hotel; bookingId: string }) {
  const readers = await listReaders(hotel.id);
  const pays = await listTerminalPayments(hotel.id, bookingId, 10);
  const open = (await bookingBalance(db(), hotel.id, bookingId)).openRappen;
  const hid = (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="bookingId" value={bookingId} /></>);
  return (
    <div className="card stack">
      <h4>Kartenzahlung am Terminal</h4>
      {pays.map((p) => (
        <div key={p.id} className="small">
          {formatChf(p.amountRappen)} · {STATUS[p.status]}
          {p.status === "pending" ? (<>
            {" "}<form action={terminalCheckAction} style={{ display: "inline" }}>{hid}<input type="hidden" name="tpId" value={p.id} /><button className="btn secondary small">Status prüfen</button></form>
            {" "}<form action={terminalCancelAction} style={{ display: "inline" }}>{hid}<input type="hidden" name="tpId" value={p.id} /><button className="btn secondary small">Abbrechen</button></form>
          </>) : null}
        </div>
      ))}
      {!readers.length ? <p className="muted small">Noch kein Kartenleser registriert (Menü «Kartenterminal»).</p> : open > 0 ? (
        <form action={terminalStartAction} className="inline-form">
          {hid}
          <div><label>Leser</label><select name="readerId">{readers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          <div><label>Betrag CHF</label><input name="amount" inputMode="decimal" required defaultValue={(open / 100).toFixed(2)} style={{ width: 110 }} /></div>
          <button className="btn small">Am Terminal bezahlen</button>
        </form>
      ) : <p className="muted small">Nichts offen.</p>}
    </div>
  );
}
