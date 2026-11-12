import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { channexConfigured } from "@/src/integrations/channex/client";
import { pairKey } from "@/src/integrations/channex/booking-mapping";
import {
  EXPEDIA_BOOKING_AMOUNT,
  EXPEDIA_MIN_STAY,
  getMetaChannel,
  mappablePlans,
  META_CHANNELS,
  type MetaChannel,
} from "@/src/integrations/channex/channels";
import { activateAction, deactivateAction, mappingAction, probeAction, removeAction } from "./actions";

/** Gemeinsame Seite für Kanäle mit Hotel-ID und Zimmer/Tarif-Zuordnung (Booking.com, Expedia) */
export async function MetaChannelView({ hotelId, channel, msg }: { hotelId: string; channel: MetaChannel; msg?: string }) {
  const cfg = META_CHANNELS[channel];
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager") && channexConfigured();
  const ch = await getMetaChannel(hotel.id, channel);
  const plans = (await mappablePlans(hotel.id)).filter((p) => p.channexRatePlanId);
  const hidden = (
    <>
      <input type="hidden" name="hotelId" value={hotel.id} />
      <input type="hidden" name="channel" value={channel} />
    </>
  );
  const statusText = !ch ? "nicht verbunden" : ch.status === "active" ? "aktiv" : ch.channexChannelId ? "angelegt, nicht aktiv" : "geprüft, noch nicht zugeordnet";
  const created = !!ch?.channexChannelId;

  return (
    <div className="stack">
      <p className="small"><a href={`/admin/${hotel.id}/channex`}>← Channel-Manager</a></p>
      <h1>{cfg.label} verbinden</h1>
      {msg ? <p className="notice">{msg}</p> : null}
      {!channexConfigured() ? <p className="notice warn">Channex ist auf dem Server nicht konfiguriert.</p> : null}
      {!hotel.channexPropertyId ? <p className="notice warn">Zuerst auf der Channex-Seite «In Channex anlegen» ausführen.</p> : null}

      <section className="card stack">
        <h2>1. {cfg.label} Hotel-ID</h2>
        <div className="kv">
          <span className="muted">Status</span><span><span className={`badge ${ch?.status === "active" ? "" : "warn"}`}>{statusText}</span></span>
          {ch ? (<><span className="muted">Hotel-ID</span><span>{ch.externalId}</span></>) : null}
          {ch?.details.currency ? (<><span className="muted">Währung auf {cfg.label}</span><span>{ch.details.currency} (Channex rechnet um)</span></>) : null}
          {ch ? (<><span className="muted">Preismodell</span><span>{ch.details.pricing_type === "OBP" ? "Preis pro Belegung (OBP)" : "Preis pro Zimmer (Standard)"}</span></>) : null}
          {channel === "Expedia" && ch?.details.minStayType ? (<><span className="muted">Mindestaufenthalt</span><span>{ch.details.minStayType === "Arrival" ? "gilt am Anreisetag" : "gilt für jeden Tag des Aufenthalts"}</span></>) : null}
          {channel === "Expedia" && ch?.details.bookingAmount ? (<><span className="muted">Betrag in der Buchung</span><span>{ch.details.bookingAmount}</span></>) : null}
        </div>
        {ch?.lastError ? <p className="notice warn">{ch.lastError}</p> : null}
        {channel === "BookingCom" ? (
          <p className="small muted">
            Die Hotel-ID steht im Booking.com-Extranet oben links. Vorher im Extranet Channex als Konnektivitätsanbieter (Connectivity Provider) auswählen.
          </p>
        ) : (
          <p className="small muted">
            Das Hotel muss bei Expedia zuerst den Zugriff für Channex freigeben; die Anleitung dazu steht im Channex-Leitfaden zu Expedia.
            Die Hotel-ID ist die Expedia-Objektnummer.
          </p>
        )}
        {canEdit && ch?.status !== "active" ? (
          <form action={probeAction} className="inline-form">
            {hidden}
            <input name="externalHotelId" defaultValue={ch?.externalId ?? ""} placeholder={`z. B. ${cfg.idExample}`} inputMode="numeric" required />
            {channel === "Expedia" ? (
              <>
                <select name="minStayType" defaultValue={ch?.details.minStayType ?? "Arrival"} disabled={created} aria-label="Mindestaufenthalt">
                  {EXPEDIA_MIN_STAY.map((v) => <option key={v} value={v}>{v === "Arrival" ? "Mindestaufenthalt am Anreisetag" : "Mindestaufenthalt an jedem Tag"}</option>)}
                </select>
                <select name="bookingAmount" defaultValue={ch?.details.bookingAmount ?? "Collect Amount"} disabled={created} aria-label="Betrag in der Buchung">
                  {EXPEDIA_BOOKING_AMOUNT.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </>
            ) : null}
            <button className="btn secondary">{ch ? "Neu prüfen" : "Prüfen"}</button>
          </form>
        ) : null}
        {channel === "Expedia" && created ? <p className="small muted">Mindestaufenthalt und Betrag lassen sich nach dem Anlegen nur ändern, wenn die Verbindung entfernt und neu angelegt wird.</p> : null}
      </section>

      {ch ? (
        <section className="card stack">
          <h2>2. Zimmer und Tarife zuordnen</h2>
          <p className="small">
            Wählen Sie für jeden {cfg.label}-Tarif, welcher Pontivo-Tarif dort verkauft wird. Preise, Verfügbarkeit und Regeln kommen dann aus Pontivo.
            {ch.details.pricing_type === "OBP" ? ` ${cfg.label} verkauft hier pro Belegung: Pontivo sendet die Preise je Personenzahl.` : ""}
          </p>
          {!plans.length ? <p className="notice warn">Noch keine Tarife in Channex angelegt.</p> : null}
          <form action={mappingAction} className="stack">
            {hidden}
            <table className="table small">
              <thead><tr><th>{cfg.label}</th><th>Pontivo-Tarif</th></tr></thead>
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
                            {rate.readonly ? ` · auf ${cfg.label} nur lesbar` : ""}
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
              <p className="small">{cfg.label} erhält Preise und Verfügbarkeit aus Pontivo, Buchungen kommen automatisch herein.</p>
              <form action={deactivateAction}>{hidden}<button className="btn secondary">Verbindung pausieren</button></form>
            </>
          ) : (
            <>
              <p className="small">
                Beim Aktivieren <strong>überschreibt</strong> Channex Preise, Verfügbarkeit und Regeln auf {cfg.label} mit den Werten aus Pontivo.
                Danach werden die bestehenden künftigen Buchungen von {cfg.label} geladen.
              </p>
              {!hotel.channexEnabled ? <p className="notice warn">Zuerst auf der Channex-Seite den Abgleich einschalten.</p> : null}
              <form action={activateAction} className="stack">
                {hidden}
                <label><input type="checkbox" name="confirm" required /> Preise, Verfügbarkeit und Mindestaufenthalte in Pontivo stimmen.</label>
                <div><button className="btn" disabled={!hotel.channexEnabled}>{cfg.label} aktivieren</button></div>
              </form>
            </>
          )}
        </section>
      ) : null}

      {ch && canEdit ? (
        <section className="card stack">
          <h2>Verbindung entfernen</h2>
          <p className="small muted">{cfg.label} erhält danach keine Daten mehr von Pontivo. Bereits erhaltene Buchungen bleiben erhalten.</p>
          <form action={removeAction} className="stack">
            {hidden}
            <label><input type="checkbox" name="confirm" required /> Ja, Verbindung zu {cfg.label} entfernen</label>
            <div><button className="btn secondary">Entfernen</button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
