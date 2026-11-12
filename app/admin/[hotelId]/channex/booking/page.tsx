import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { channexConfigured } from "@/src/integrations/channex/client";
import { pairKey } from "@/src/integrations/channex/booking-mapping";
import {
  activateBookingChannel,
  channelErrorText,
  deactivateBookingChannel,
  getBookingChannel,
  mappablePlans,
  probeBookingChannel,
  removeBookingChannel,
  saveBookingMapping,
} from "@/src/integrations/channex/channels";

export const dynamic = "force-dynamic";

const back = (id: string, msg: string) => redirect(`/admin/${id}/channex/booking?msg=${encodeURIComponent(msg)}`);
const hid = (f: FormData) => String(f.get("hotelId"));

async function run(f: FormData, fn: (h: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>) {
  const ctx = await requireHotel(hid(f), "manager");
  let msg: string;
  try {
    msg = await fn(ctx);
  } catch (e) {
    msg = `Fehler: ${channelErrorText(e)}`;
  }
  back(ctx.hotel.id, msg);
}

async function probeAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await probeBookingChannel(hotel, String(f.get("bookingHotelId") ?? ""), actor);
    return "Hotel-ID akzeptiert. Jetzt die Zimmer und Tarife zuordnen.";
  });
}
async function mappingAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    const sel: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith("map:") && v) sel[k.slice(4)] = String(v);
    await saveBookingMapping(hotel, sel, actor);
    return "Zuordnung gespeichert";
  });
}
async function activateAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte bestätigen, dass Preise und Verfügbarkeit stimmen");
    const r = await activateBookingChannel(hotel, actor);
    return r.loaded
      ? "Booking.com ist verbunden. Bestehende Buchungen werden geladen."
      : "Booking.com ist verbunden, aber bestehende Buchungen konnten nicht geladen werden (siehe Hinweis).";
  });
}
async function deactivateAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    await deactivateBookingChannel(hotel, actor);
    return "Verbindung pausiert. Booking.com erhält keine Änderungen mehr.";
  });
}
async function removeAction(f: FormData) {
  "use server";
  await run(f, async ({ hotel, actor }) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte das Entfernen bestätigen");
    await removeBookingChannel(hotel, actor);
    return "Verbindung entfernt";
  });
}

export default async function BookingChannelPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager") && channexConfigured();
  const ch = await getBookingChannel(hotel.id);
  const plans = (await mappablePlans(hotel.id)).filter((p) => p.channexRatePlanId);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const statusText = !ch ? "nicht verbunden" : ch.status === "active" ? "aktiv" : ch.channexChannelId ? "angelegt, nicht aktiv" : "geprüft, noch nicht zugeordnet";

  return (
    <div className="stack">
      <p className="small"><a href={`/admin/${hotel.id}/channex`}>← Channel-Manager</a></p>
      <h1>Booking.com verbinden</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      {!channexConfigured() ? <p className="notice warn">Channex ist auf dem Server nicht konfiguriert.</p> : null}
      {!hotel.channexPropertyId ? <p className="notice warn">Zuerst auf der Channex-Seite «In Channex anlegen» ausführen.</p> : null}

      <section className="card stack">
        <h2>1. Booking.com Hotel-ID</h2>
        <div className="kv">
          <span className="muted">Status</span><span><span className={`badge ${ch?.status === "active" ? "" : "warn"}`}>{statusText}</span></span>
          {ch ? (<><span className="muted">Hotel-ID</span><span>{ch.externalId}</span></>) : null}
          {ch?.details.currency ? (<><span className="muted">Währung auf Booking.com</span><span>{ch.details.currency} (Channex rechnet um)</span></>) : null}
          {ch ? (<><span className="muted">Preismodell</span><span>{ch.details.pricing_type === "OBP" ? "Preis pro Belegung (OBP)" : "Preis pro Zimmer (Standard)"}</span></>) : null}
        </div>
        {ch?.lastError ? <p className="notice warn">{ch.lastError}</p> : null}
        <p className="small muted">
          Die Hotel-ID steht im Booking.com-Extranet oben links. Vorher im Extranet Channex als Konnektivitätsanbieter (Connectivity Provider) auswählen.
        </p>
        {canEdit && ch?.status !== "active" ? (
          <form action={probeAction} className="inline-form">
            {hidden}
            <input name="bookingHotelId" defaultValue={ch?.externalId ?? ""} placeholder="z. B. 5868189" inputMode="numeric" required />
            <button className="btn secondary">{ch ? "Neu prüfen" : "Prüfen"}</button>
          </form>
        ) : null}
      </section>

      {ch ? (
        <section className="card stack">
          <h2>2. Zimmer und Tarife zuordnen</h2>
          <p className="small">
            Wählen Sie für jeden Booking.com-Tarif, welcher Pontivo-Tarif dort verkauft wird. Preise, Verfügbarkeit und Regeln kommen dann aus Pontivo.
            {ch.details.pricing_type === "OBP" ? " Booking.com verkauft hier pro Belegung: Pontivo sendet die Preise je Personenzahl." : ""}
          </p>
          {!plans.length ? <p className="notice warn">Noch keine Tarife in Channex angelegt.</p> : null}
          <form action={mappingAction} className="stack">
            {hidden}
            <table className="table small">
              <thead><tr><th>Booking.com</th><th>Pontivo-Tarif</th></tr></thead>
              <tbody>
                {ch.details.rooms.flatMap((room) =>
                  room.rates.map((rate) => {
                    const key = pairKey(room.id, rate.id);
                    return (
                      <tr key={key}>
                        <td>
                          <strong>{room.title}</strong> – {rate.title}
                          <div className="muted">
                            {rate.occupancies?.length ? `${rate.occupancies.join(", ")} Pers.` : rate.max_persons ? `bis ${rate.max_persons} Pers.` : ""}
                            {rate.readonly ? " · auf Booking.com nur lesbar" : ""}
                          </div>
                        </td>
                        <td>
                          <select name={`map:${key}`} defaultValue={ch.selection[key] ?? ""} disabled={!canEdit || rate.readonly}>
                            <option value="">– nicht verkaufen –</option>
                            {plans.map((p) => <option key={p.id} value={p.id}>{p.roomName} – {p.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
            {canEdit ? <div><button className="btn">Zuordnung speichern</button></div> : null}
          </form>
        </section>
      ) : null}

      {ch?.channexChannelId && canEdit ? (
        <section className="card stack">
          <h2>3. Aktivieren</h2>
          {ch.status === "active" ? (
            <>
              <p className="small">Booking.com erhält Preise und Verfügbarkeit aus Pontivo, Buchungen kommen automatisch herein.</p>
              <form action={deactivateAction}>{hidden}<button className="btn secondary">Verbindung pausieren</button></form>
            </>
          ) : (
            <>
              <p className="small">
                Beim Aktivieren <strong>überschreibt</strong> Channex Preise, Verfügbarkeit und Regeln auf Booking.com mit den Werten aus Pontivo.
                Danach werden die bestehenden künftigen Buchungen von Booking.com geladen.
              </p>
              {!hotel.channexEnabled ? <p className="notice warn">Zuerst auf der Channex-Seite den Abgleich einschalten.</p> : null}
              <form action={activateAction} className="stack">
                {hidden}
                <label><input type="checkbox" name="confirm" required /> Preise, Verfügbarkeit und Mindestaufenthalte in Pontivo stimmen.</label>
                <div><button className="btn" disabled={!hotel.channexEnabled}>Booking.com aktivieren</button></div>
              </form>
            </>
          )}
        </section>
      ) : null}

      {ch && canEdit ? (
        <section className="card stack">
          <h2>Verbindung entfernen</h2>
          <p className="small muted">Booking.com erhält danach keine Daten mehr von Pontivo. Bereits erhaltene Buchungen bleiben erhalten.</p>
          <form action={removeAction} className="stack">
            {hidden}
            <label><input type="checkbox" name="confirm" required /> Ja, Verbindung zu Booking.com entfernen</label>
            <div><button className="btn secondary">Entfernen</button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
