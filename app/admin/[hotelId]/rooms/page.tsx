import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import {
  changePhoto, createRatePlan, createRoomType, listRooms, MAX_PHOTOS, RoomError, updateRatePlan, updateRoomType,
  type RatePlanInput, type RoomTypeInput,
} from "@/src/services/rooms";
import { deleteImage } from "@/src/lib/storage";
import { decimalToRappen, rappenToDecimal } from "@/src/domain/money";
import { cancellationPolicyText } from "@/src/domain/cancellation";
import type { RatePlan, RoomType } from "@/src/db/schema";
import { hotelLocales, LOCALE_NAMES, type Locale } from "@/src/i18n/dict";
import { translateRooms, translationEnabled, translationsLeft, TranslateError } from "@/src/services/translate";

/** Sprachen ausser Deutsch (Deutsch steht im Hauptfeld) */
const EXTRA = ["en", "fr", "it", "nl"] as const;

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => Number(s(f, k) || 0);
const chf = (f: FormData, k: string) => (s(f, k) ? decimalToRappen(s(f, k).replace(",", ".").replace(/'/g, "")) : 0);

function errorText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(", ");
  if (e instanceof RoomError) return e.message;
  if (e instanceof Error && /ungültiger Betrag/.test(e.message)) return "Ungültiger Betrag";
  throw e;
}

function roomInput(f: FormData): RoomTypeInput {
  return {
    name: s(f, "name"),
    description: s(f, "description") || null,
    roomCount: n(f, "roomCount"),
    maxAdults: n(f, "maxAdults"),
    maxChildren: n(f, "maxChildren"),
    maxOccupancy: n(f, "maxOccupancy"),
    sortOrder: n(f, "sortOrder"),
    active: f.get("active") === "on",
    i18n: Object.fromEntries(EXTRA.map((l) => [l, { name: s(f, `name.${l}`) || undefined, description: s(f, `description.${l}`) || undefined }])),
  };
}

function planInput(f: FormData): RatePlanInput {
  const flexible = s(f, "cancelMode") === "free";
  return {
    name: s(f, "name"),
    breakfastIncluded: f.get("breakfast") === "on",
    freeCancelHours: flexible ? Math.round(n(f, "freeCancelDays") * 24) : null,
    cancelFeeBps: Math.round(n(f, "cancelFeePct") * 100),
    baseOccupancy: n(f, "baseOccupancy"),
    extraAdultRappen: chf(f, "extraAdult"),
    singleDiscountRappen: chf(f, "singleDiscount"),
    active: f.get("active") === "on",
    i18n: Object.fromEntries(EXTRA.map((l) => [l, { name: s(f, `name.${l}`) || undefined }])),
  };
}

/** Hilfsfunktion für die Server Actions unten: Rechte prüfen, ausführen, Meldung anzeigen */
async function act(f: FormData, fn: (ctx: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>, anchor = "") {
  const ctx = await requireHotel(s(f, "hotelId"), "manager");
  let msg: string;
  try {
    msg = await fn(ctx);
  } catch (e) {
    msg = `Nicht gespeichert: ${errorText(e)}`;
  }
  revalidatePath(`/admin/${ctx.hotel.id}/rooms`);
  redirect(`/admin/${ctx.hotel.id}/rooms?msg=${encodeURIComponent(msg)}${anchor}`);
}

async function translateAll(f: FormData) {
  "use server";
  await act(f, async ({ hotel, actor }) => {
    try {
      const n = await translateRooms(hotel, actor);
      return n ? `${n} Feld(er) übersetzt – bitte kurz gegenlesen` : "Nichts zu übersetzen: alle Felder sind schon ausgefüllt";
    } catch (e) {
      if (e instanceof TranslateError) return `Nicht übersetzt: ${e.message}`;
      throw e;
    }
  });
}

async function saveRoom(f: FormData) {
  "use server";
  const id = s(f, "roomTypeId");
  await act(f, async ({ hotel, actor }) => {
    if (id) {
      await updateRoomType(hotel.id, id, roomInput(f), actor);
      return "Zimmertyp gespeichert";
    }
    await createRoomType(hotel.id, roomInput(f), actor);
    return "Zimmertyp angelegt. Jetzt einen Tarif hinzufügen.";
  }, id ? `#rt-${id}` : "");
}

async function savePlan(f: FormData) {
  "use server";
  const id = s(f, "ratePlanId");
  await act(f, async ({ hotel, actor }) => {
    if (id) {
      await updateRatePlan(hotel.id, id, planInput(f), actor);
      return "Tarif gespeichert";
    }
    await createRatePlan(hotel.id, s(f, "roomTypeId"), planInput(f), chf(f, "price"), actor);
    return "Tarif angelegt. Preise pro Tag passt du im Kalender an.";
  }, `#rt-${s(f, "roomTypeId")}`);
}

async function photoAction(f: FormData) {
  "use server";
  const roomTypeId = s(f, "roomTypeId") || null;
  const action = s(f, "action") === "remove" ? "remove" : "first";
  await act(f, async ({ hotel, actor }) => {
    await changePhoto(hotel.id, roomTypeId, s(f, "url"), action, actor);
    if (action === "remove") await deleteImage(s(f, "url"));
    return action === "remove" ? "Foto entfernt" : "Titelbild gesetzt";
  }, roomTypeId ? `#rt-${roomTypeId}` : "#hotel-photos");
}

function Photos({ hotelId, roomTypeId, photos, canEdit }: { hotelId: string; roomTypeId: string | null; photos: { url: string; alt?: string }[]; canEdit: boolean }) {
  return (
    <div className="stack">
      {photos.length ? (
        <div className="photo-grid">
          {photos.map((p, i) => (
            <figure key={p.url} className="photo">
              <img src={p.url} alt={p.alt ?? ""} loading="lazy" />
              {i === 0 ? <span className="badge">Titelbild</span> : null}
              {canEdit ? (
                <div className="photo-actions">
                  {i > 0 ? (
                    <form action={photoAction}>
                      <input type="hidden" name="hotelId" value={hotelId} />
                      <input type="hidden" name="roomTypeId" value={roomTypeId ?? ""} />
                      <input type="hidden" name="url" value={p.url} />
                      <input type="hidden" name="action" value="first" />
                      <button className="btn secondary small">Als Titelbild</button>
                    </form>
                  ) : null}
                  <form action={photoAction}>
                    <input type="hidden" name="hotelId" value={hotelId} />
                    <input type="hidden" name="roomTypeId" value={roomTypeId ?? ""} />
                    <input type="hidden" name="url" value={p.url} />
                    <input type="hidden" name="action" value="remove" />
                    <button className="btn secondary small">Entfernen</button>
                  </form>
                </div>
              ) : null}
            </figure>
          ))}
        </div>
      ) : (
        <p className="muted small">Noch keine Fotos.</p>
      )}
      {canEdit && photos.length < MAX_PHOTOS ? (
        <form action={`/api/admin/hotels/${hotelId}/photos`} method="post" encType="multipart/form-data" className="inline-form">
          <input type="hidden" name="roomTypeId" value={roomTypeId ?? ""} />
          <div style={{ flex: "1 1 220px" }}>
            <label>Fotos hochladen (JPG, PNG, WebP, max. 8 MB, bis 3 aufs Mal)</label>
            <input type="file" name="file" accept="image/jpeg,image/png,image/webp" multiple required />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label>Bildbeschreibung (optional)</label>
            <input name="alt" placeholder="z. B. Doppelzimmer mit Seesicht" />
          </div>
          <button className="btn small">Hochladen</button>
        </form>
      ) : null}
    </div>
  );
}

function RoomForm({ hotelId, rt, canEdit, nextOrder = 0, langs }: { hotelId: string; rt?: RoomType; canEdit: boolean; nextOrder?: number; langs: Locale[] }) {
  return (
    <form action={saveRoom} className="stack">
      <input type="hidden" name="hotelId" value={hotelId} />
      <input type="hidden" name="roomTypeId" value={rt?.id ?? ""} />
      <div className="form-grid">
        <div><label>Name</label><input name="name" defaultValue={rt?.name} required disabled={!canEdit} placeholder="z. B. Doppelzimmer Seesicht" /></div>
        <div><label>Anzahl Zimmer dieses Typs</label><input name="roomCount" type="number" min={0} defaultValue={rt?.roomCount ?? 1} required disabled={!canEdit} /></div>
        <div><label>Max. Erwachsene</label><input name="maxAdults" type="number" min={1} defaultValue={rt?.maxAdults ?? 2} required disabled={!canEdit} /></div>
        <div><label>Max. Kinder</label><input name="maxChildren" type="number" min={0} defaultValue={rt?.maxChildren ?? 0} required disabled={!canEdit} /></div>
        <div><label>Max. Personen total</label><input name="maxOccupancy" type="number" min={1} defaultValue={rt?.maxOccupancy ?? 2} required disabled={!canEdit} /></div>
        <div><label>Reihenfolge auf der Website</label><input name="sortOrder" type="number" min={0} defaultValue={rt?.sortOrder ?? nextOrder} disabled={!canEdit} /></div>
      </div>
      <div><label>Beschreibung</label><textarea name="description" rows={2} defaultValue={rt?.description ?? ""} disabled={!canEdit} placeholder="Grösse, Bett, Aussicht, Ausstattung" /></div>
      {EXTRA.map((l) => langs.includes(l) ? (
        <div key={l} className="form-grid">
          <div><label>Name {LOCALE_NAMES[l]}</label><input name={`name.${l}`} defaultValue={rt?.i18n?.[l]?.name ?? ""} disabled={!canEdit} placeholder={l === "en" ? "z. B. Double room with lake view" : ""} /></div>
          <div style={{ gridColumn: "span 2" }}><label>Beschreibung {LOCALE_NAMES[l]}</label><textarea name={`description.${l}`} rows={2} defaultValue={rt?.i18n?.[l]?.description ?? ""} disabled={!canEdit} /></div>
        </div>
      ) : (
        <span key={l} hidden>
          {rt?.i18n?.[l]?.name ? <input type="hidden" name={`name.${l}`} value={rt.i18n[l]!.name} /> : null}
          {rt?.i18n?.[l]?.description ? <textarea name={`description.${l}`} defaultValue={rt.i18n[l]!.description} hidden readOnly /> : null}
        </span>
      ))}
      <label className="check"><input type="checkbox" name="active" defaultChecked={rt?.active ?? true} disabled={!canEdit} />Buchbar (auf der Website und bei Portalen)</label>
      {canEdit ? <button className="btn">{rt ? "Zimmertyp speichern" : "Zimmertyp anlegen"}</button> : null}
    </form>
  );
}

function PlanForm({ hotelId, roomTypeId, p, canEdit, langs }: { hotelId: string; roomTypeId: string; p?: RatePlan; canEdit: boolean; langs: Locale[] }) {
  const free = p ? p.freeCancelHours !== null : true;
  return (
    <form action={savePlan} className="stack">
      <input type="hidden" name="hotelId" value={hotelId} />
      <input type="hidden" name="roomTypeId" value={roomTypeId} />
      <input type="hidden" name="ratePlanId" value={p?.id ?? ""} />
      <div className="form-grid">
        <div><label>Name des Tarifs</label><input name="name" defaultValue={p?.name ?? "Flexibel"} required disabled={!canEdit} /></div>
        {EXTRA.map((l) => langs.includes(l) ? (
          <div key={l}><label>Name {LOCALE_NAMES[l]}</label><input name={`name.${l}`} defaultValue={p?.i18n?.[l]?.name ?? (p ? "" : l === "en" ? "Flexible" : "")} disabled={!canEdit} /></div>
        ) : p?.i18n?.[l]?.name ? <input key={l} type="hidden" name={`name.${l}`} value={p.i18n[l]!.name} /> : null)}
        {!p ? <div><label>Startpreis CHF pro Nacht</label><input name="price" inputMode="decimal" required placeholder="z. B. 180" disabled={!canEdit} /></div> : null}
        <div><label>Preis gilt für Personen</label><input name="baseOccupancy" type="number" min={1} defaultValue={p?.baseOccupancy ?? 2} required disabled={!canEdit} /></div>
        <div><label>Zuschlag je weitere erw. Person CHF</label><input name="extraAdult" inputMode="decimal" defaultValue={p ? rappenToDecimal(p.extraAdultRappen) : "0"} disabled={!canEdit} /></div>
        <div><label>Rabatt bei 1 Person CHF</label><input name="singleDiscount" inputMode="decimal" defaultValue={p ? rappenToDecimal(p.singleDiscountRappen) : "0"} disabled={!canEdit} /></div>
      </div>
      <div className="form-grid">
        <div>
          <label>Stornierung</label>
          <select name="cancelMode" defaultValue={free ? "free" : "none"} disabled={!canEdit}>
            <option value="free">Kostenlos bis … Tage vor Anreise</option>
            <option value="none">Nicht kostenlos stornierbar</option>
          </select>
        </div>
        <div><label>Tage vor Anreise (bei kostenlos)</label><input name="freeCancelDays" type="number" min={0} step="0.5" defaultValue={p?.freeCancelHours != null ? p.freeCancelHours / 24 : 2} disabled={!canEdit} /></div>
        <div><label>Gebühr danach in % des Zimmerpreises</label><input name="cancelFeePct" type="number" min={0} max={100} defaultValue={p ? p.cancelFeeBps / 100 : 100} disabled={!canEdit} /></div>
      </div>
      <label className="check"><input type="checkbox" name="breakfast" defaultChecked={p?.breakfastIncluded ?? true} disabled={!canEdit} />Frühstück inbegriffen</label>
      <label className="check"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} disabled={!canEdit} />Buchbar</label>
      {p ? <p className="muted small">Gast sieht: {cancellationPolicyText(p, "de")}</p> : <p className="muted small">Der Startpreis gilt für alle Tage der nächsten 18 Monate. Wochenend- oder Saisonpreise setzt du danach im Kalender.</p>}
      {canEdit ? <button className="btn small">{p ? "Tarif speichern" : "Tarif anlegen"}</button> : null}
    </form>
  );
}

export default async function Rooms({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const list = await listRooms(hotel.id);
  const langs = hotelLocales(hotel);
  const left = translationsLeft(hotel);

  return (
    <div className="stack">
      <h1>Zimmer und Tarife</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") || sp.msg.includes(":") ? "warn" : ""}`}>{sp.msg}</p> : null}
      {hotel.channexEnabled ? <p className="notice warn small">Neue Zimmertypen oder Tarife zusätzlich auf der Seite «Channex» anlegen bzw. zuordnen, damit sie auch bei Booking.com erscheinen.</p> : null}

      {langs.length > 1 && canEdit && translationEnabled() ? (
        <form action={translateAll} className="inline-form" style={{ gap: 8 }}>
          <input type="hidden" name="hotelId" value={hotel.id} />
          <button className="btn secondary small" disabled={!left}>Fehlende Namen und Beschreibungen übersetzen</button>
          <span className="small muted">aus dem Deutschen nach {langs.filter((l) => l !== "de").map((l) => l.toUpperCase()).join(", ")} · noch {left} diesen Monat</span>
        </form>
      ) : null}

      <section className="card stack" id="hotel-photos">
        <h2>Fotos des Hotels</h2>
        <p className="muted small">Das erste Foto erscheint gross auf der Startseite.</p>
        <Photos hotelId={hotel.id} roomTypeId={null} photos={hotel.content.photos ?? []} canEdit={canEdit} />
      </section>

      {list.map(({ roomType: rt, plans }) => (
        <section key={rt.id} className="card stack" id={`rt-${rt.id}`}>
          <h2>
            {rt.name} <span className="muted small">({rt.roomCount} Zimmer{rt.active ? "" : ", nicht buchbar"})</span>
          </h2>
          <details>
            <summary className="btn secondary small">Zimmertyp bearbeiten</summary>
            <div style={{ marginTop: 12 }}><RoomForm hotelId={hotel.id} rt={rt} canEdit={canEdit} langs={langs} /></div>
          </details>
          <h3>Fotos</h3>
          <Photos hotelId={hotel.id} roomTypeId={rt.id} photos={rt.photos} canEdit={canEdit} />
          <h3>Tarife</h3>
          {plans.length === 0 ? <p className="notice warn small">Noch kein Tarif – ohne Tarif ist das Zimmer nicht buchbar.</p> : null}
          {plans.map((p) => (
            <details key={p.id} className="card">
              <summary>
                <strong>{p.name}</strong> <span className="muted small">· {p.breakfastIncluded ? "mit Frühstück" : "ohne Frühstück"} · {p.freeCancelHours !== null ? `kostenlos stornierbar bis ${p.freeCancelHours / 24} Tag(e) vorher` : "nicht kostenlos stornierbar"}{p.active ? "" : " · nicht buchbar"}</span>
              </summary>
              <div style={{ marginTop: 12 }}><PlanForm hotelId={hotel.id} roomTypeId={rt.id} p={p} canEdit={canEdit} langs={langs} /></div>
            </details>
          ))}
          {canEdit ? (
            <details>
              <summary className="btn secondary small">+ Tarif hinzufügen</summary>
              <div style={{ marginTop: 12 }}><PlanForm hotelId={hotel.id} roomTypeId={rt.id} canEdit={canEdit} langs={langs} /></div>
            </details>
          ) : null}
        </section>
      ))}

      {canEdit ? (
        <section className="card stack">
          <h2>Neuer Zimmertyp</h2>
          <RoomForm hotelId={hotel.id} canEdit={canEdit} langs={langs} nextOrder={list.reduce((m, x) => Math.max(m, x.roomType.sortOrder + 1), 0)} />
        </section>
      ) : null}
    </div>
  );
}
