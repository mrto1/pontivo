import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { atLeast } from "@/src/auth/session";
import { listInquiries, setInquiryStatus } from "@/src/services/inquiries";
import { createOfferFromInquiry, listOffers, OfferError } from "@/src/services/offers";
import { OFFER_STATUS_LABEL } from "@/src/domain/offers";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { table: "Tisch reservieren", group: "Gruppe", seminar: "Seminar / Tagung", wedding: "Hochzeit / Fest", company: "Firmenanlass", other: "Anderes" };

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "manager");
  await setInquiryStatus(c.hotel.id, String(f.get("id")), f.get("status") === "done" ? "done" : "new", c.actor);
  redirect(`/admin/${c.hotel.id}/inquiries`);
}

async function makeOffer(f: FormData) {
  "use server";
  const c = await requireHotel(String(f.get("hotelId")), "manager");
  await requireModule(c.hotel.id, "inquiries");
  try {
    const o = await createOfferFromInquiry(c.hotel, String(f.get("id")), c.actor);
    redirect(`/admin/${c.hotel.id}/offers/${o.id}`);
  } catch (e) {
    if (!(e instanceof OfferError)) throw e;
    redirect(`/admin/${c.hotel.id}/inquiries`);
  }
}

export default async function Inquiries({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "inquiries");
  await requireModule(hotel.id, "inquiries");
  const canEdit = atLeast(role, "manager");
  const list = await listInquiries(hotel.id);
  const offerList = await listOffers(hotel.id);
  const offersOf = (id: string) => offerList.filter((o) => o.inquiryId === id);
  const open = list.filter((x) => x.status === "new").length;
  return (
    <div className="stack">
      <h1>Anfragen</h1>
      <p className="muted small">Aus dem Website-Baustein «Anfrageformular». Jede Anfrage kommt auch per E-Mail an {hotel.contactEmail}. Antworten Sie direkt per E-Mail an den Gast. {open ? <strong>{open} offen.</strong> : null}</p>
      {list.length ? (
        <div className="stack">
          {list.map((q) => (
            <article key={q.id} className="card stack" style={{ opacity: q.status === "done" ? 0.65 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>{KIND[q.kind] ?? q.kind} · {q.name}</h3>
                <span className="small muted">{q.createdAt.toLocaleString("de-CH", { timeZone: hotel.timezone })} · Sprache {q.language.toUpperCase()}{q.pageSlug ? ` · Seite /${q.pageSlug}` : ""}</span>
              </div>
              <div className="kv small">
                <span className="muted">E-Mail</span><a href={`mailto:${q.email}?subject=${encodeURIComponent(`Ihre Anfrage – ${hotel.name}`)}`}>{q.email}</a>
                {q.phone ? (<><span className="muted">Telefon</span><a href={`tel:${q.phone.replace(/\s/g, "")}`}>{q.phone}</a></>) : null}
                {q.dateFrom ? (<><span className="muted">Datum</span><span>{formatDay(q.dateFrom, "de")}{q.dateTo ? ` – ${formatDay(q.dateTo, "de")}` : ""}{q.timeOfDay ? `, ${q.timeOfDay} Uhr` : ""}</span></>) : null}
                {q.persons ? (<><span className="muted">Personen</span><span>{q.persons}</span></>) : null}
              </div>
              {q.message ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{q.message}</p> : null}
              {offersOf(q.id).map((o) => <p key={o.id} className="small" style={{ margin: 0 }}>Angebot: <a href={`/admin/${hotel.id}/offers/${o.id}`}>{o.title}</a> · {OFFER_STATUS_LABEL[o.status]}</p>)}
              {canEdit && q.kind !== "table" ? (
                <form action={makeOffer}>
                  <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={q.id} />
                  <button className="btn small">Angebot erstellen</button>
                </form>
              ) : null}
              {canEdit ? (
                <form action={toggle}>
                  <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="status" value={q.status === "new" ? "done" : "new"} />
                  <button className="btn secondary small">{q.status === "new" ? "Als erledigt markieren" : "Wieder öffnen"}</button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      ) : <p className="muted">Noch keine Anfragen. Fügen Sie auf einer Seite den Baustein «Anfrageformular» ein, z. B. auf «Seminare» oder «Hochzeiten».</p>}
    </div>
  );
}
