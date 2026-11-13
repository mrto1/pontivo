import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { db } from "@/src/db/client";
import { roomTypes } from "@/src/db/schema";
import { eq, asc } from "drizzle-orm";
import { env } from "@/src/env";
import { addFeed, exportUrl, IcalError, listFeeds, regenerateToken, removeFeed, syncFeed } from "@/src/services/ical";
import { CopyBox } from "@/components/admin/CopyBox";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (hotelId: string, msg: string) => redirect(`/admin/${hotelId}/ical?msg=${encodeURIComponent(msg)}`);
const errText = (e: unknown) => {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(", ");
  if (e instanceof IcalError || e instanceof Error) return e.message;
  return "Unbekannter Fehler";
};

async function add(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg = "";
  try {
    const feed = await addFeed(c.hotel.id, s(f, "roomTypeId"), { name: s(f, "name"), url: s(f, "url") }, c.actor);
    const r = await syncFeed(feed.id);
    msg = r.ok ? `Kalender hinzugefügt: ${r.added} belegte Nächte übernommen.` : `Kalender gespeichert, aber der erste Abruf klappte nicht: ${r.error}`;
  } catch (e) {
    msg = `Nicht gespeichert: ${errText(e)}`;
  }
  back(c.hotel.id, msg);
}

async function remove(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  try {
    await removeFeed(c.hotel.id, s(f, "feedId"), c.actor);
  } catch (e) {
    back(c.hotel.id, `Nicht entfernt: ${errText(e)}`);
  }
  back(c.hotel.id, "Kalender entfernt, die Nächte sind wieder frei.");
}

async function syncNow(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  const feeds = await listFeeds(c.hotel.id);
  const feed = feeds.find((x) => x.id === s(f, "feedId"));
  if (!feed) back(c.hotel.id, "Kalender nicht gefunden");
  const r = await syncFeed(feed!.id);
  back(c.hotel.id, r.ok ? `Abgeglichen: ${r.added} neu belegt, ${r.removed} freigegeben.` : `Abruf fehlgeschlagen: ${r.error}`);
}

async function renew(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  try {
    await regenerateToken(c.hotel.id, s(f, "roomTypeId"), c.actor);
  } catch (e) {
    back(c.hotel.id, `Nicht erneuert: ${errText(e)}`);
  }
  back(c.hotel.id, "Neue Adresse erzeugt. Die alte funktioniert nicht mehr, tragen Sie die neue überall ein.");
}

const when = (d: Date | null) => (d ? d.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }) : "noch nie");

export default async function IcalPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const rts = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id)).orderBy(asc(roomTypes.sortOrder));
  const feeds = await listFeeds(hotel.id);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <h1>Kalender-Abgleich (iCal)</h1>
      {sp.msg ? <p className={`notice ${/^(Nicht|Abruf|Kalender gespeichert)/.test(sp.msg) ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="muted">
        Für Wohnungen und Zimmer ohne Channel-Manager: So vermeiden Sie Doppelbuchungen mit Airbnb, Booking.com, Vrbo und anderen. Der Abgleich ist nicht in Echtzeit, wir holen fremde Kalender etwa alle 15 Minuten ab, andere Plattformen holen unseren oft nur alle paar Stunden. Wenn Sie
        den Channel-Manager nutzen, brauchen Sie das nicht.
      </p>

      {rts.map((rt) => {
        const mine = feeds.filter((x) => x.roomTypeId === rt.id);
        return (
          <section key={rt.id} className="card stack">
            <h2>{rt.name}</h2>

            <h3>Unsere Belegung weitergeben</h3>
            <p className="muted">Diese Adresse tragen Sie bei der anderen Plattform als Kalender-Import ein. Sie zeigt nur «Belegt», keine Gästedaten. Halten Sie sie geheim.</p>
            <CopyBox text={exportUrl(env().APP_BASE_URL, rt.icalToken)} label={`Kalenderadresse ${rt.name}`} />
            {canEdit ? (
              <form action={renew}>
                {hidden}
                <input type="hidden" name="roomTypeId" value={rt.id} />
                <button className="btn secondary small">Neue Adresse erzeugen</button>
              </form>
            ) : null}

            <h3>Fremde Kalender übernehmen</h3>
            {mine.length ? (
              <ul className="stack">
                {mine.map((x) => (
                  <li key={x.id}>
                    <strong>{x.name}</strong> · zuletzt abgeglichen: {when(x.lastSyncedAt)}
                    {x.lastError ? <span className="notice warn"> Fehler: {x.lastError}</span> : null}
                    {x.lastConflicts > 0 ? <span className="notice warn"> {x.lastConflicts} Nacht/Nächte doppelt belegt, bitte im Kalender prüfen.</span> : null}
                    {canEdit ? (
                      <span className="row">
                        <form action={syncNow}>{hidden}<input type="hidden" name="feedId" value={x.id} /><button className="btn secondary small">Jetzt abgleichen</button></form>
                        <form action={remove}>{hidden}<input type="hidden" name="feedId" value={x.id} /><button className="btn secondary small">Entfernen</button></form>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Noch kein Kalender eingetragen.</p>
            )}
            {canEdit ? (
              <form action={add} className="stack">
                {hidden}
                <input type="hidden" name="roomTypeId" value={rt.id} />
                <div><label>Name (z. B. Airbnb)</label><input name="name" maxLength={80} required /></div>
                <div><label>Kalenderadresse (https://…)</label><input name="url" type="url" maxLength={2000} required placeholder="https://www.airbnb.ch/calendar/ical/….ics" /></div>
                <button className="btn">Kalender hinzufügen</button>
              </form>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
