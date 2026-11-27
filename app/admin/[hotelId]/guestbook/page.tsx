import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { allTags, GuestNoteError, kartei, profileOf, REGULAR_VISITS, saveProfile } from "@/src/services/guest-notes";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { Notice } from "@/components/admin/Notice";
import { s } from "@/src/lib/form";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

/** Rücksprung nur innerhalb der Verwaltung dieses Betriebs (z. B. zur Reservationsliste) */
const backTo = (hotelId: string, v: string | undefined) => (v && v.startsWith(`/admin/${hotelId}/`) && !v.includes("//") ? v : `/admin/${hotelId}/guestbook`);

async function saveGuest(f: FormData) {
  "use server";
  const c = await requireHotelModule("guestnotes", s(f, "hotelId"), "staff", "guestbook");
  const back = backTo(c.hotel.id, s(f, "back"));
  const sep = back.includes("?") ? "&" : "?";
  try { await saveProfile(c.hotel.id, s(f, "email"), { note: s(f, "note"), tags: s(f, "tags") }, c.actor); }
  catch (e) {
    if (!(e instanceof GuestNoteError)) throw e;
    redirect(`/admin/${c.hotel.id}/guestbook?gast=${encodeURIComponent(s(f, "email"))}&zurueck=${encodeURIComponent(back)}&msg=${encodeURIComponent(`Nicht gespeichert: ${e.message}`)}`);
  }
  redirect(`${back}${sep}msg=${encodeURIComponent("Kartei gespeichert.")}`);
}

/** Kartei (SPEC 17.2): Gäste mit Aufenthalten, Tags und Notizen, durchsuchbar. Gast antippen öffnet Tags und Notiz in der Seitenleiste. */
export default async function Guestbook({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("guestnotes", hotelId, "staff", "guestbook");
  const q = (sp.q ?? "").slice(0, 80);
  const tag = (sp.tag ?? "").slice(0, 24);
  const [rows, tags, mods] = await Promise.all([kartei(hotel.id, q, tag), allTags(hotel.id), moduleRows(hotel.id)]);
  const dining = isOn(mods, "restaurant");
  const lodging = hotel.propertyType !== "restaurant";
  const guest = sp.gast ? sp.gast.trim().toLowerCase().slice(0, 200) : "";
  const prof = guest ? await profileOf(hotel.id, guest) : null;
  const row = guest ? rows.find((r) => r.email === guest) ?? (await kartei(hotel.id, guest, "", 1)).find((r) => r.email === guest) : undefined;
  const back = backTo(hotel.id, sp.zurueck);
  return (
    <div className="stack">
      <h1 className="sr-only">Kartei</h1>
      {sp.msg && !guest ? <Notice text={sp.msg} /> : null}
      {guest ? (
        <Drawer title={row?.name || guest} closeHref={back}>
          {sp.msg ? <Notice text={sp.msg} /> : null}
          <p className="small muted m0">{guest}{row ? ` · ${[lodging ? `${row.stays} Aufenthalt${row.stays === 1 ? "" : "e"}` : "", dining ? `${row.visits} Restaurantbesuch${row.visits === 1 ? "" : "e"}` : ""].filter(Boolean).join(" · ")}` : ""}</p>
          <form action={saveGuest} className="stack">
            <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="email" value={guest} /><input type="hidden" name="back" value={back} />
            <div><label htmlFor="gb-tags">Tags (Komma)</label><input id="gb-tags" name="tags" defaultValue={prof?.tags.join(", ") ?? ""} placeholder="Stammgast, Fensterplatz" maxLength={200} /></div>
            <div><label htmlFor="gb-note">Notiz</label><textarea id="gb-note" name="note" rows={3} defaultValue={prof?.note ?? ""} maxLength={1000} placeholder="z. B. ohne Nüsse, mag Ecktisch, Zimmer oben" /></div>
            <p className="small muted m0">Allergien nur als kurzer Hinweis für die Küche, keine Gesundheitsangaben. Gilt für diese E-Mail-Adresse und nur in diesem Betrieb.</p>
            <DrawerActions submit="Speichern" cancelHref={back} />
          </form>
        </Drawer>
      ) : null}
      <form method="get" className="inline-form">
        <input name="q" type="search" aria-label="Suche" defaultValue={q} placeholder="Name, E-Mail, Tag oder Notiz suchen" maxLength={80} />
        {tags.length ? (
          <select name="tag" aria-label="Tag" defaultValue={tag}><option value="">alle Tags</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        ) : null}
        <button className="btn secondary small">Suchen</button>
      </form>
      <section className="card">
        {rows.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Gast</th>{lodging ? <><th>Aufenthalte</th><th>Letzte Anreise</th></> : null}{dining ? <><th>Restaurant</th><th>Letzter Besuch</th></> : null}<th>Tags</th><th>Notiz</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}>
                  <td><Link href={`?gast=${encodeURIComponent(r.email)}`} scroll={false}><strong>{r.name || "–"}</strong></Link><div className="small muted">{r.email}</div></td>
                  {lodging ? <><td>{r.stays}</td><td className="small">{r.lastCheckin ? formatDay(r.lastCheckin, "de") : "–"}</td></> : null}
                  {dining ? <><td>{r.visits}{r.visits >= REGULAR_VISITS ? <> <span className="badge">Stammgast</span></> : null}</td><td className="small">{r.lastVisit ? formatDay(r.lastVisit, "de") : "–"}</td></> : null}
                  <td>{r.tags.map((t) => <span key={t} className="badge" style={{ marginRight: 4 }}>{t}</span>)}</td>
                  <td className="small">{r.note.slice(0, 120)}{r.note.length > 120 ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="muted small">Keine Treffer.</p>}
        {rows.length >= 200 ? <p className="muted small">Es werden die neuesten 200 gezeigt. Mit der Suche finden Sie weitere.</p> : null}
      </section>
      <p className="small muted">Notizen und Tags bearbeiten Sie hier (Gast antippen), bei der Buchung{dining ? " oder über «Kartei» in der Reservationsliste" : ""}. Sie gelten für die E-Mail-Adresse und nur in diesem Betrieb.{dining ? ` Ab ${REGULAR_VISITS} Restaurantbesuchen steht «Stammgast». Allergien nur als kurzer Hinweis für die Küche (z. B. «ohne Nüsse»), keine Gesundheitsangaben.` : ""}</p>
    </div>
  );
}
