import { codesOfBooking, nukiConfigured } from "@/src/services/door-access";
import type { Hotel } from "@/src/db/schema";
import { issueAction, revokeAction } from "./access-actions";

const ST: Record<string, string> = { pending: "wird angelegt", active: "aktiv", revoked: "zurückgezogen", expired: "abgelaufen", error: "Fehler" };

/** Zutrittscodes der Buchung (Modul «Zutritt (Nuki)») */
export async function AccessCard({ hotel, bookingId, status }: { hotel: Hotel; bookingId: string; status: string }) {
  if (!nukiConfigured(hotel)) return <div className="card" id="zutritt"><h3>Zutritt</h3><p className="muted small">Nuki ist noch nicht eingerichtet (Menü «Zutritt»).</p></div>;
  const codes = await codesOfBooking(hotel.id, bookingId);
  const hid = (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="bookingId" value={bookingId} /></>);
  return (
    <div className="card stack" id="zutritt">
      <h3>Zutritt</h3>
      {codes.length ? (
        <table className="table"><tbody>
          {codes.map((c) => (
            <tr key={c.id}>
              <td>{c.lockName}</td>
              <td>{c.code ? <code style={{ fontSize: "1.1em", letterSpacing: 2 }}>{c.code}</code> : "–"}</td>
              <td className="small">{ST[c.status]}{c.error ? ` (${c.error})` : ""}</td>
              <td className="small muted">{c.validFrom.toISOString().slice(0, 16).replace("T", " ")} UTC bis {c.validUntil.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
            </tr>
          ))}
        </tbody></table>
      ) : <p className="muted small">Noch keine Codes. Sie werden 3 Tage vor Anreise automatisch erstellt.</p>}
      <div className="inline-form">
        {status === "confirmed" ? <form action={issueAction}>{hid}<button className="btn secondary small">Codes jetzt erstellen / Fehler wiederholen</button></form> : null}
        {codes.some((c) => c.status === "active" || c.status === "pending") ? <form action={revokeAction}>{hid}<button className="btn secondary small">Codes zurückziehen</button></form> : null}
      </div>
    </div>
  );
}
