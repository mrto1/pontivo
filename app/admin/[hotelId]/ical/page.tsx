import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
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
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";

const run = (f: FormData, fail: string, fn: (c: HotelCtx) => Promise<string>) =>
  hotelAction(f, { page: "ical", role: "manager", fail }, fn);

async function add(f: FormData) {
  "use server";
  await run(f, "Nicht gespeichert", async (c) => {
    const feed = await addFeed(c.hotel.id, s(f, "roomTypeId"), { name: s(f, "name"), url: s(f, "url") }, c.actor);
    const r = await syncFeed(feed.id);
    return r.ok ? `Kalender hinzugefügt: ${r.added} belegte Nächte übernommen.` : `Kalender gespeichert, aber der erste Abruf klappte nicht: ${r.error}`;
  });
}

async function remove(f: FormData) {
  "use server";
  await run(f, "Nicht entfernt", async (c) => { await removeFeed(c.hotel.id, s(f, "feedId"), c.actor); return "Kalender entfernt, die Nächte sind wieder frei."; });
}

async function syncNow(f: FormData) {
  "use server";
  await run(f, "Nicht abgeglichen", async (c) => {
    const feed = (await listFeeds(c.hotel.id)).find((x) => x.id === s(f, "feedId"));
    if (!feed) throw new IcalError("Kalender nicht gefunden");
    const r = await syncFeed(feed.id);
    return r.ok ? `Abgeglichen: ${r.added} neu belegt, ${r.removed} freigegeben.` : `Abruf fehlgeschlagen: ${r.error}`;
  });
}

async function renew(f: FormData) {
  "use server";
  await run(f, "Nicht erneuert", async (c) => {
    await regenerateToken(c.hotel.id, s(f, "roomTypeId"), c.actor);
    return "Neue Adresse erzeugt. Die alte funktioniert nicht mehr, tragen Sie die neue überall ein.";
  });
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
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Für Wohnungen und Zimmer ohne Channel-Manager: So vermeiden Sie Doppelbuchungen mit Airbnb, Booking.com, Vrbo und anderen. Der Abgleich ist nicht in Echtzeit, wir holen fremde Kalender etwa alle 15 Minuten ab, andere Plattformen holen unseren oft nur alle paar Stunden. Wenn Sie
        den Channel-Manager nutzen, brauchen Sie das nicht.</InfoTip></div>

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
                <div><label htmlFor={`fa49bm1-${rt.id}`}>Name (z. B. Airbnb)</label><input id={`fa49bm1-${rt.id}`} name="name" maxLength={80} required /></div>
                <div><label htmlFor={`fa49bm2-${rt.id}`}>Kalenderadresse (https://…)</label><input id={`fa49bm2-${rt.id}`} name="url" type="url" maxLength={2000} required placeholder="https://www.airbnb.ch/calendar/ical/….ics" /></div>
                <button className="btn">Kalender hinzufügen</button>
              </form>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
