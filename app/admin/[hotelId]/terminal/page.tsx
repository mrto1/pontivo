import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { InvoiceError } from "@/src/services/invoicing";
import { listReaders, listTerminalPayments, registerReader } from "@/src/services/terminal";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const STATUS: Record<string, string> = { pending: "läuft", succeeded: "bezahlt", failed: "fehlgeschlagen", canceled: "abgebrochen" };

async function register(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager", "terminal");
  await requireModule(c.hotel.id, "terminal");
  let msg = "Kartenleser registriert.";
  try { await registerReader(c.hotel, { registrationCode: s(f, "code"), label: s(f, "label") }, c.actor); } catch (e) { if (!(e instanceof InvoiceError)) throw e; msg = e.message; }
  redirect(`/admin/${c.hotel.id}/terminal?msg=${encodeURIComponent(msg)}`);
}

export default async function TerminalPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager", "terminal");
  await requireModule(hotel.id, "terminal");
  const readers = await listReaders(hotel.id);
  const pays = await listTerminalPayments(hotel.id);
  return (
    <div className="stack">
      <h1>Kartenterminal</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      <p className="muted">Kartenzahlung am Empfang mit einem Stripe-Kartenleser (z. B. WisePOS E oder S700). Die Zahlung geht auf Ihr Stripe-Konto und wird in der Buchung als «Karte» verbucht. Bezahlt wird auf der Buchung unter «Rechnung &amp; Kasse».</p>
      <div className="card stack">
        <h3>Kartenleser</h3>
        {readers.length ? <ul>{readers.map((r) => <li key={r.id}>{r.label}</li>)}</ul> : <p className="muted small">Noch kein Gerät.</p>}
        <form action={register} className="inline-form">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <div><label>Registrierungscode (am Gerät anzeigen)</label><input name="code" required placeholder="z. B. sepia-cheese-orchid" /></div>
          <div><label>Bezeichnung</label><input name="label" maxLength={60} placeholder="Empfang" /></div>
          <button className="btn small">Gerät registrieren</button>
        </form>
      </div>
      <div className="card stack">
        <h3>Letzte Terminal-Zahlungen</h3>
        {pays.length ? <table className="table"><tbody>{pays.map((p) => <tr key={p.id}><td className="small">{p.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td>{formatChf(p.amountRappen)}</td><td>{STATUS[p.status]}</td><td><a href={`/admin/${hotel.id}/bookings/${p.bookingId}#kasse`}>Buchung</a></td></tr>)}</tbody></table> : <p className="muted small">Noch keine.</p>}
      </div>
    </div>
  );
}
