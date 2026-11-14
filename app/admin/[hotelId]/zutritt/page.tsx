import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { db } from "@/src/db/client";
import { rooms } from "@/src/db/schema";
import { AccessError, listLocks, nukiConfigured, saveNukiToken, setLockRoom, syncLocks } from "@/src/services/door-access";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>) {
  const c = await requireHotel(s(f, "hotelId"), "manager", "access");
  await requireModule(c.hotel.id, "access");
  let msg: string;
  try { msg = await fn(c); } catch (e) { if (!(e instanceof AccessError)) throw e; msg = e.message; }
  redirect(`/admin/${c.hotel.id}/zutritt?msg=${encodeURIComponent(msg)}`);
}
async function token(f: FormData) { "use server"; await act(f, async (c) => { await saveNukiToken(c.hotel, s(f, "token"), c.actor); return "Token gespeichert."; }); }
async function sync(f: FormData) { "use server"; await act(f, async (c) => `${await syncLocks(c.hotel, c.actor)} Schloss/Schlösser geladen.`); }
async function assign(f: FormData) { "use server"; await act(f, async (c) => { await setLockRoom(c.hotel.id, s(f, "lockId"), s(f, "roomId") || null, c.actor); return "Gespeichert."; }); }

export default async function Zutritt({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager", "access");
  await requireModule(hotel.id, "access");
  const locks = await listLocks(hotel.id);
  const rs = (await db().select().from(rooms).where(eq(rooms.hotelId, hotel.id))).filter((r) => r.active).sort((a, b) => a.number.localeCompare(b.number, "de", { numeric: true }));
  const hid = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Zutritt (Nuki)</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      <p className="muted">Jede bestätigte Buchung bekommt 3 Tage vor Anreise automatisch einen Keypad-Code für alle Eingangstüren und für das zugewiesene Zimmer, gültig von Check-in bis Check-out. Nach Abreise oder Storno wird der Code gelöscht. Voraussetzung: Nuki Keypad, Nuki Web-Konto und ein API-Token mit dem Recht «smartlock.auth».</p>
      <div className="card stack">
        <h3>1. Nuki-Token</h3>
        <p className="small muted">{nukiConfigured(hotel) ? "Token ist hinterlegt (verschlüsselt). Zum Ersetzen neu eingeben." : "Noch kein Token."} Erzeugen in Nuki Web unter «API &amp; Integrationen».</p>
        <form action={token} className="inline-form">{hid}<div style={{ minWidth: 280 }}><label>API-Token</label><input name="token" type="password" autoComplete="off" required /></div><button className="btn small">Prüfen und speichern</button></form>
      </div>
      {nukiConfigured(hotel) ? (
        <div className="card stack">
          <h3>2. Schlösser</h3>
          <form action={sync}>{hid}<button className="btn secondary small">Schlösser von Nuki laden</button></form>
          {locks.length ? locks.map((l) => (
            <form key={l.id} action={assign} className="inline-form">
              {hid}<input type="hidden" name="lockId" value={l.id} />
              <div style={{ minWidth: 180 }}><strong>{l.name}</strong></div>
              <div><label>Gehört zu</label><select name="roomId" defaultValue={l.roomId ?? ""}><option value="">Eingangstür (alle Gäste)</option>{rs.map((r) => <option key={r.id} value={r.id}>Zimmer {r.number}</option>)}</select></div>
              <button className="btn secondary small">Speichern</button>
            </form>
          )) : <p className="muted small">Noch keine Schlösser geladen.</p>}
        </div>
      ) : null}
    </div>
  );
}
