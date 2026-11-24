import { Notice } from "@/components/admin/Notice";
import { notFound, redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { moduleOn } from "@/src/services/modules";
import { OfferError, offerWithLines, saveOffer, sendOffer } from "@/src/services/offers";
import { listResources } from "@/src/services/resources";
import { decimalToRappen, rappenToDecimal } from "@/src/domain/money";
import { hhmm } from "@/src/domain/resources";
import { OFFER_STATUS_LABEL } from "@/src/domain/offers";
import { OfferSheet } from "@/components/offers/OfferSheet";

export const dynamic = "force-dynamic";
const EXTRA_ROWS = 3;
const val = (f: FormData, k: string) => f.getAll(k).map((x) => String(x ?? "").trim());

async function save(f: FormData) {
  "use server";
  const c = await requireHotelModule("inquiries", String(f.get("hotelId")), "manager", "inquiries");
  const id = String(f.get("id"));
  const [desc, qty, unit, vat, res, day, from, to, pers] = ["desc", "qty", "unit", "vat", "res", "day", "from", "to", "pers"].map((k) => val(f, k));
  const lines = desc.map((d, i) => d ? {
    description: d, quantity: Number(qty[i] || 1), unitRappen: unit[i] ? decimalToRappen(unit[i].replace(",", ".")) : 0, vatKind: (vat[i] || "standard") as "standard",
    resourceId: res[i] || null, day: day[i] || null, start: from[i] || null, end: to[i] || null, persons: pers[i] ? Number(pers[i]) : null,
  } : null).filter((x) => x !== null);
  let msg = "Gespeichert.";
  try {
    await saveOffer(c.hotel, id, { title: String(f.get("title")), intro: String(f.get("intro") ?? ""), company: String(f.get("company") ?? ""), validUntil: String(f.get("validUntil")), lines }, c.actor);
    if (f.get("send") === "1") { await sendOffer(c.hotel, id, c.actor); msg = "Angebot gesendet."; }
  } catch (e) {
    if (!(e instanceof OfferError) && !(e instanceof Error && e.name === "ZodError")) throw e;
    msg = `Nicht gespeichert: ${e instanceof OfferError ? e.message : "Bitte Eingaben prüfen (Datum, Zahlen)."}`;
  }
  redirect(`/admin/${c.hotel.id}/offers/${id}?msg=${encodeURIComponent(msg)}`);
}

export default async function OfferAdmin({ params, searchParams }: { params: Promise<{ hotelId: string; offerId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId, offerId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("inquiries", hotelId, "manager", "inquiries");
  const d = await offerWithLines(hotel.id, offerId);
  if (!d) notFound();
  const { offer, lines } = d;
  const useRooms = await moduleOn(hotel.id, "resources");
  const rooms = useRooms ? await listResources(hotel.id, true) : [];
  const names = Object.fromEntries(rooms.map((r) => [r.id, r.name]));
  if (offer.status !== "draft") {
    return (
      <div className="stack">
        <h1>Angebot {offer.title} <span className="badge">{OFFER_STATUS_LABEL[offer.status]}</span></h1>
        {sp.msg ? <Notice text={sp.msg} /> : null}
        <p className="muted small">Gesendet an {offer.customerEmail}. Der Kunde sieht es unter <code>/o/{offer.publicToken}</code>. {offer.decisionNote ? <>Nachricht des Kunden: «{offer.decisionNote}»</> : null}</p>
        <OfferSheet hotel={hotel} offer={offer} lines={lines} resourceNames={names} />
        <p><a href={`/admin/${hotel.id}/inbox?quelle=web`}>Zurück zu den Anfragen</a></p>
      </div>
    );
  }
  const rows = [...lines.map((l) => ({ l })), ...Array.from({ length: EXTRA_ROWS }, () => ({ l: null }))];
  return (
    <div className="stack">
      <h1>Angebot erstellen</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <p className="muted small">Für {offer.customerName} ({offer.customerEmail}). Preise inklusive MWST. Zeilen mit einem Angebot vor Ort (z. B. Seminarraum) reservieren den Raum erst, wenn der Kunde zusagt.</p>
      <form action={save} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={offer.id} />
        <label>Titel<input name="title" defaultValue={offer.title} required maxLength={160} /></label>
        <label>Firma (optional)<input name="company" defaultValue={offer.company} maxLength={160} /></label>
        <label>Einleitung<textarea name="intro" rows={3} defaultValue={offer.intro} maxLength={4000} /></label>
        <label>Gültig bis<input type="date" name="validUntil" defaultValue={offer.validUntil} required /></label>
        <h2>Positionen</h2>
        {rows.map(({ l }, i) => (
          <div key={l?.id ?? `new${i}`} className="card stack">
            <div className="row">
              <label style={{ flex: 3 }}>Beschreibung<input name="desc" defaultValue={l?.description ?? ""} maxLength={200} /></label>
              <label>Menge<input name="qty" type="number" min={1} defaultValue={l?.quantity ?? 1} className="w80" /></label>
              <label>Preis CHF<input className="w110" name="unit" defaultValue={l ? rappenToDecimal(l.unitRappen) : ""} placeholder="0.00" /></label>
              <label>MWST<select name="vat" defaultValue={l?.vatKind ?? "standard"}><option value="standard">Normal</option><option value="stay">Beherbergung</option><option value="none">Keine</option></select></label>
            </div>
            {useRooms ? (
              <div className="row small">
                <label>Raum / Angebot vor Ort<select name="res" defaultValue={l?.resourceId ?? ""}><option value="">– keine Reservation –</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label>Tag<input type="date" name="day" defaultValue={l?.day ?? ""} /></label>
                <label>Von<input name="from" placeholder="09:00" defaultValue={l?.startMin != null ? hhmm(l.startMin) : ""} className="w80" /></label>
                <label>Bis<input name="to" placeholder="17:00" defaultValue={l?.endMin != null ? (l.endMin === 1440 ? "24:00" : hhmm(l.endMin)) : ""} className="w80" /></label>
                <label>Personen<input name="pers" type="number" min={1} defaultValue={l?.persons ?? ""} className="w80" /></label>
              </div>
            ) : (<><input type="hidden" name="res" value="" /><input type="hidden" name="day" value="" /><input type="hidden" name="from" value="" /><input type="hidden" name="to" value="" /><input type="hidden" name="pers" value="" /></>)}
          </div>
        ))}
        <p className="small muted">Preis 0 bei einer Raumzeile mit Menge 1: der Preis des Angebots vor Ort wird übernommen. Weitere Zeilen: speichern, dann erscheinen neue leere Zeilen.</p>
        <div className="row">
          <button className="btn secondary">Entwurf speichern</button>
          <button className="btn" name="send" value="1">Speichern und an den Kunden senden</button>
        </div>
      </form>
      <h2>Vorschau</h2>
      <OfferSheet hotel={hotel} offer={offer} lines={lines} resourceNames={names} />
    </div>
  );
}
