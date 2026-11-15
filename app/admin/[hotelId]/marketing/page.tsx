import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { NewsletterError, listNewsletters, previewRecipients, saveDraft, sendNewsletter, sendTest } from "@/src/services/newsletter";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (h: string, msg: string, id?: string) => redirect(`/admin/${h}/marketing?${id ? `edit=${id}&` : ""}msg=${encodeURIComponent(msg)}`);
const seg = (f: FormData) => ({ language: s(f, "language"), tag: s(f, "tag"), stayedSince: s(f, "stayedSince"), minStays: Number(s(f, "minStays") || 0) });

async function save(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "marketing");
  try {
    const n = await saveDraft(c.hotel.id, s(f, "id") || null, { subject: s(f, "subject"), body: String(f.get("body") ?? ""), segment: seg(f) }, c.actor);
    back(c.hotel.id, "Entwurf gespeichert.", n.id);
  } catch (e) {
    if (!(e instanceof NewsletterError)) throw e;
    back(c.hotel.id, `Nicht gespeichert: ${e.message}`, s(f, "id") || undefined);
  }
}
async function test(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "marketing");
  let msg = "Testmail wird versendet.";
  try { await sendTest(c.hotel, s(f, "id"), s(f, "to"), c.actor); } catch (e) { if (!(e instanceof NewsletterError)) throw e; msg = `Nicht gesendet: ${e.message}`; }
  back(c.hotel.id, msg, s(f, "id"));
}
async function send(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "marketing");
  let msg: string;
  try { msg = `Versand an ${await sendNewsletter(c.hotel, s(f, "id"), c.actor)} Gäste gestartet.`; } catch (e) { if (!(e instanceof NewsletterError)) throw e; msg = `Nicht versendet: ${e.message}`; }
  back(c.hotel.id, msg);
}

export default async function MarketingPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "marketing");
  const list = await listNewsletters(hotel.id);
  const cur = list.find((n) => n.id === sp.edit && n.status === "draft") ?? null;
  const count = (await previewRecipients(hotel.id, cur?.segment ?? {})).length;
  return (
    <div className="stack">
      <h1>Newsletter</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="muted">Gesendet wird nur an Gäste, die bei der Buchung dem Newsletter zugestimmt haben. Jede Mail enthält einen Abmeldelink. Aktuell erreichen Sie {count} Gäste{cur ? " mit dieser Auswahl" : " (alle mit Einwilligung)"}.</p>
      <form action={save} className="card stack">
        <h2>{cur ? "Entwurf bearbeiten" : "Neuer Newsletter"}</h2>
        <input type="hidden" name="hotelId" value={hotel.id} />{cur ? <input type="hidden" name="id" value={cur.id} /> : null}
        <div><label>Betreff</label><input name="subject" defaultValue={cur?.subject ?? ""} required maxLength={150} /></div>
        <div><label>Text (Absätze mit Leerzeile)</label><textarea name="body" rows={8} defaultValue={cur?.body ?? ""} required /></div>
        <div><label>Nur Sprache (leer = alle)</label><select name="language" defaultValue={cur?.segment.language ?? ""}><option value="">alle</option><option value="de">Deutsch</option><option value="en">Englisch</option><option value="fr">Französisch</option><option value="it">Italienisch</option></select></div>
        <div><label>Nur Gäste mit Stichwort (aus der Gästekartei)</label><input name="tag" defaultValue={cur?.segment.tag ?? ""} /></div>
        <div><label>Nur Gäste mit Aufenthalt seit (Abreise ab Datum)</label><input name="stayedSince" type="date" defaultValue={cur?.segment.stayedSince ?? ""} /></div>
        <div><label>Mindestens so viele Aufenthalte</label><input name="minStays" type="number" min={0} max={99} defaultValue={cur?.segment.minStays ?? 0} /></div>
        <div><button className="btn">Entwurf speichern</button></div>
      </form>
      {cur ? (
        <section className="card stack">
          <form action={test} className="stack"><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={cur.id} /><label>Testmail an</label><input name="to" type="email" required /><div><button className="btn secondary">Testmail senden</button></div></form>
          <form action={send}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={cur.id} /><button className="btn">An {count} Gäste senden</button></form>
        </section>
      ) : null}
      <section className="card">
        <h2>Bisherige</h2>
        {list.length ? <ul className="list">{list.map((n) => <li key={n.id}>{n.status === "draft" ? <a href={`/admin/${hotel.id}/marketing?edit=${n.id}`}>{n.subject} (Entwurf)</a> : <>{n.subject} · {n.recipients} Empfänger · {n.sentAt?.toLocaleDateString("de-CH")}</>}</li>)}</ul> : <p className="muted">Noch keine.</p>}
      </section>
    </div>
  );
}
