import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { atLeast } from "@/src/auth/session";
import { FeedbackError, feedbackSettings, feedbackSummary, listFeedback, saveFeedbackSettings } from "@/src/services/feedback";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function save(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "feedback");
  let msg = "Einstellungen gespeichert.";
  try {
    await saveFeedbackSettings(c.hotel, { reviewUrl: s(f, "reviewUrl"), minScore: Number(s(f, "minScore")) }, c.actor);
  } catch (e) {
    if (!(e instanceof FeedbackError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/feedback?msg=${encodeURIComponent(msg)}`);
}

export default async function FeedbackAdmin({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "feedback");
  await requireModule(hotel.id, "feedback");
  const set = feedbackSettings(hotel);
  const [list, sum] = await Promise.all([listFeedback(hotel.id), feedbackSummary(hotel.id)]);
  return (
    <div className="stack">
      <h1 className="sr-only">Bewertungen</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <p className="muted">Nach dem Aufenthalt (Nachher-Mail, nur Gäste mit Einwilligung) fragen wir die Gäste nach einer Note. Ab der Mindestnote erhalten sie den Link zu Ihrer Bewertungsseite, darunter geht die Rückmeldung nur an Sie (per E-Mail).</p>
      {atLeast(role, "manager") ? (
        <form action={save} className="card stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <div><label htmlFor="reviewUrl">Link zu Ihrer Bewertungsseite (z. B. Google oder Tripadvisor, https://…)</label><input id="reviewUrl" name="reviewUrl" type="url" defaultValue={set.reviewUrl} placeholder="https://" /></div>
          <div><label htmlFor="minScore">Link anzeigen ab Note</label><input id="minScore" name="minScore" type="number" min={2} max={5} defaultValue={set.minScore} /></div>
          <div><button className="btn">Speichern</button></div>
        </form>
      ) : null}
      <section className="card">
        <h2>Rückmeldungen {sum.n ? `(${sum.n}, Durchschnitt ${sum.average})` : ""}</h2>
        {list.length ? (
          <table className="table"><thead><tr><th>Datum</th><th>Buchung</th><th>Gast</th><th>Note</th><th>Kommentar</th></tr></thead><tbody>
            {list.map((x) => <tr key={x.id}><td>{formatDay(x.createdAt.toISOString().slice(0, 10), "de")}</td><td>{x.reference}</td><td>{x.guestName}</td><td>{x.score} / 5{x.publicLinkShown ? " · Link gezeigt" : ""}</td><td>{x.comment}</td></tr>)}
          </tbody></table>
        ) : <p className="muted">Noch keine Rückmeldungen.</p>}
      </section>
    </div>
  );
}
