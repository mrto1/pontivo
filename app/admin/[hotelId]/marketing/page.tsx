import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { NewsletterError, listNewsletters, previewRecipients, saveDraft, sendNewsletter, sendTest } from "@/src/services/newsletter";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";
const seg = (f: FormData) => ({ language: s(f, "language"), tag: s(f, "tag"), stayedSince: s(f, "stayedSince"), minStays: Number(s(f, "minStays") || 0) });
/** Entwurf bleibt offen (`edit`), auch bei einem Fehler */
const run = (f: FormData, fail: string, fn: (c: HotelCtx) => Promise<string | { to: string }>, edit = s(f, "id")) =>
  hotelAction(f, { page: "marketing", module: "marketing", role: "manager", fail, keep: { edit } }, fn);

async function save(f: FormData) {
  "use server";
  await run(f, "Nicht gespeichert", async (c) => {
    const n = await saveDraft(c.hotel.id, s(f, "id") || null, { subject: s(f, "subject"), body: String(f.get("body") ?? ""), segment: seg(f) }, c.actor);
    return { to: `/admin/${c.hotel.id}/marketing?edit=${n.id}&msg=${encodeURIComponent("Entwurf gespeichert.")}` };
  });
}
async function test(f: FormData) {
  "use server";
  await run(f, "Nicht gesendet", async (c) => { await sendTest(c.hotel, s(f, "id"), s(f, "to"), c.actor); return "Testmail wird versendet."; });
}
async function send(f: FormData) {
  "use server";
  await run(f, "Nicht versendet", async (c) => `Versand an ${await sendNewsletter(c.hotel, s(f, "id"), c.actor)} Gäste gestartet.`, "");
}

export default async function MarketingPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("marketing", hotelId, "manager");
  const list = await listNewsletters(hotel.id);
  const cur = list.find((n) => n.id === sp.edit && n.status === "draft") ?? null;
  const count = (await previewRecipients(hotel.id, cur?.segment ?? {})).length;
  return (
    <div className="stack">
      <h1 className="sr-only">Newsletter</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <p className="muted">Gesendet wird nur an Gäste, die bei der Buchung dem Newsletter zugestimmt haben. Jede Mail enthält einen Abmeldelink. Aktuell erreichen Sie {count} Gäste{cur ? " mit dieser Auswahl" : " (alle mit Einwilligung)"}.</p>
      <form action={save} className="card stack">
        <h2>{cur ? "Entwurf bearbeiten" : "Neuer Newsletter"}</h2>
        <input type="hidden" name="hotelId" value={hotel.id} />{cur ? <input type="hidden" name="id" value={cur.id} /> : null}
        <div><label htmlFor="f84301">Betreff</label><input id="f84301" name="subject" defaultValue={cur?.subject ?? ""} required maxLength={150} /></div>
        <div><label htmlFor="f84302">Text (Absätze mit Leerzeile)</label><textarea id="f84302" name="body" rows={8} defaultValue={cur?.body ?? ""} required /></div>
        <div><label htmlFor="f84303">Nur Sprache (leer = alle)</label><select id="f84303" name="language" defaultValue={cur?.segment.language ?? ""}><option value="">alle</option><option value="de">Deutsch</option><option value="en">Englisch</option><option value="fr">Französisch</option><option value="it">Italienisch</option></select></div>
        <div><label htmlFor="f84304">Nur Gäste mit Stichwort (aus der Gästekartei)</label><input id="f84304" name="tag" defaultValue={cur?.segment.tag ?? ""} /></div>
        <div><label htmlFor="f84305">Nur Gäste mit Aufenthalt seit (Abreise ab Datum)</label><input id="f84305" name="stayedSince" type="date" defaultValue={cur?.segment.stayedSince ?? ""} /></div>
        <div><label htmlFor="f84306">Mindestens so viele Aufenthalte</label><input id="f84306" name="minStays" type="number" min={0} max={99} defaultValue={cur?.segment.minStays ?? 0} /></div>
        <div><button className="btn">Entwurf speichern</button></div>
      </form>
      {cur ? (
        <section className="card stack">
          <form action={test} className="stack"><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={cur.id} /><label htmlFor="f84307">Testmail an</label><input id="f84307" name="to" type="email" required /><div><button className="btn secondary">Testmail senden</button></div></form>
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
