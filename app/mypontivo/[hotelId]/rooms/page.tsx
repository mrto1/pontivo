import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import {
  createRatePlan, createRoomType, listRooms, RoomError, updateRatePlan, updateRoomType,
  type RatePlanInput, type RoomTypeInput,
} from "@/src/services/rooms";
import { decimalToRappen, rappenToDecimal } from "@/src/domain/money";
import { cancellationPolicyText } from "@/src/domain/cancellation";
import type { RatePlan, RoomType } from "@/src/db/schema";
import { boardLabel } from "@/src/domain/board";
import { hotelLocales, LOCALE_NAMES, type Locale } from "@/src/i18n/dict";
import { PhotoManager } from "@/components/admin/PhotoManager";
import { DrawerKeys } from "@/components/admin/DrawerKeys";
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
    arrivalInfo: s(f, "arrivalInfo") || null,
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
    board: (["none", "breakfast", "half", "full"].includes(s(f, "board")) ? s(f, "board") : "none") as "none",
    mealRappen: chf(f, "mealChf"),
    freeCancelHours: flexible ? Math.round(n(f, "freeCancelDays") * 24) : null,
    cancelFeeBps: Math.round(n(f, "cancelFeePct") * 100),
    baseOccupancy: n(f, "baseOccupancy"),
    extraAdultRappen: chf(f, "extraAdult"),
    singleDiscountRappen: chf(f, "singleDiscount"),
    minNights: Math.max(1, n(f, "minNights") || 1),
    arrivalWeekdays: f.getAll("arrivalWeekdays").map(Number),
    active: f.get("active") === "on",
    i18n: Object.fromEntries(EXTRA.map((l) => [l, { name: s(f, `name.${l}`) || undefined }])),
  };
}

/** Hilfsfunktion für die Server Actions unten: Rechte prüfen, ausführen, Meldung anzeigen */
async function act(f: FormData, fn: (ctx: Awaited<ReturnType<typeof requireHotel>>) => Promise<string | { msg: string; q: string }>, q = "") {
  const ctx = await requireHotel(s(f, "hotelId"), "manager");
  let msg: string;
  try {
    const r = await fn(ctx);
    if (typeof r === "string") msg = r; else { msg = r.msg; q = r.q; }
  } catch (e) {
    msg = `Nicht gespeichert: ${errorText(e)}`;
  }
  revalidatePath(`/mypontivo/${ctx.hotel.id}/rooms`);
  // q = Adressteil der Seitenleiste (z. B. «rt=…&tab=tarife»), damit sie nach dem Speichern offen bleibt
  redirect(`/mypontivo/${ctx.hotel.id}/rooms?${q ? `${q}&` : ""}msg=${encodeURIComponent(msg)}`);
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
      return { msg: "Zimmertyp gespeichert", q: `rt=${id}&tab=grunddaten` };
    }
    const input = roomInput(f);
    const rt = await createRoomType(hotel.id, input, actor);
    // Mit Startpreis gleich einen Tarif «Standard» anlegen: ohne Tarif ist ein Zimmertyp weder buchbar noch im Kalender bearbeitbar
    if (chf(f, "startPrice") > 0) {
      await createRatePlan(hotel.id, rt.id, {
        name: "Standard", board: "none", mealRappen: 0, freeCancelHours: 48, cancelFeeBps: 10000, // ASSUMPTION: kostenlos stornierbar bis 2 Tage vorher, danach 100 %
        baseOccupancy: Math.min(2, input.maxOccupancy), extraAdultRappen: 0, singleDiscountRappen: 0, minNights: 1, arrivalWeekdays: [], active: true,
      }, chf(f, "startPrice"), actor);
      return { msg: "Zimmertyp mit Tarif «Standard» angelegt. Preise pro Tag passen Sie im Kalender an.", q: `rt=${rt.id}&tab=tarife` };
    }
    return { msg: "Zimmertyp angelegt. Jetzt einen Tarif hinzufügen.", q: `rt=${rt.id}&tab=tarife&plan=neu` };
  }, id ? `rt=${id}&tab=grunddaten` : "neu=1");
}

async function savePlan(f: FormData) {
  "use server";
  const id = s(f, "ratePlanId");
  await act(f, async ({ hotel, actor }) => {
    if (id) {
      await updateRatePlan(hotel.id, id, planInput(f), actor);
      return { msg: "Tarif gespeichert", q: `rt=${s(f, "roomTypeId")}&tab=tarife` };
    }
    await createRatePlan(hotel.id, s(f, "roomTypeId"), planInput(f), chf(f, "price"), actor);
    return { msg: "Tarif angelegt. Preise pro Tag passen Sie im Kalender an.", q: `rt=${s(f, "roomTypeId")}&tab=tarife` };
  }, `rt=${s(f, "roomTypeId")}&tab=tarife&plan=${id || "neu"}`);
}

function RoomForm({ hotelId, rt, canEdit, nextOrder = 0, langs, cancelHref }: { hotelId: string; rt?: RoomType; canEdit: boolean; nextOrder?: number; langs: Locale[]; cancelHref: string }) {
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
      <div><label>Ankunftsinfos für diese Wohnung/dieses Zimmer (optional)</label><textarea name="arrivalInfo" rows={3} maxLength={2000} defaultValue={rt?.arrivalInfo ?? ""} disabled={!canEdit} placeholder="z. B. Schlüsselbox-Code, WLAN. Überschreibt die allgemeinen Infos zur Ankunft. Gäste sehen es nur während ihres Aufenthalts." /></div>
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
      {!rt && canEdit ? (
        <div className="form-grid">
          <div><label>Startpreis CHF pro Nacht (optional)</label><input name="startPrice" inputMode="decimal" placeholder="z. B. 180" title="Legt gleich den Tarif «Standard» an. Weitere Tarife und Tagespreise später." /></div>
        </div>
      ) : null}
      <label className="check"><input type="checkbox" name="active" defaultChecked={rt?.active ?? true} disabled={!canEdit} />Buchbar (auf der Website und bei Portalen)</label>
      {canEdit ? <div className="drawer-actions"><button className="btn">{rt ? "Speichern" : "Zimmertyp anlegen"}</button><Link className="btn secondary" href={cancelHref} scroll={false}>Abbrechen</Link></div> : null}
    </form>
  );
}

function PlanForm({ hotelId, roomTypeId, p, canEdit, langs, cancelHref }: { hotelId: string; roomTypeId: string; p?: RatePlan; canEdit: boolean; langs: Locale[]; cancelHref: string }) {
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
        <div><label>Mindestaufenthalt (Nächte)</label><input name="minNights" type="number" min={1} max={60} defaultValue={p?.minNights ?? 1} disabled={!canEdit} title="Für Pakete wie «3 Nächte mit Halbpension». Gilt immer, zusätzlich zu den Regeln im Kalender." /></div>
      </div>
      <fieldset className="plain"><legend className="small muted">Anreise nur an (keiner gewählt = jeder Tag; z. B. Ferienwohnung nur Samstag)</legend>
        <div className="weekdays">{[1, 2, 3, 4, 5, 6, 0].map((w) => <label key={w}><input type="checkbox" name="arrivalWeekdays" value={w} defaultChecked={p?.arrivalWeekdays.includes(w)} disabled={!canEdit} />{["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][w]}</label>)}</div>
      </fieldset>
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
      <div className="grid">
        <div>
          <label>Verpflegung</label>
          <select name="board" defaultValue={p?.board ?? "breakfast"} disabled={!canEdit}>
            <option value="none">Nur Übernachtung</option>
            <option value="breakfast">Mit Frühstück</option>
            <option value="half">Halbpension</option>
            <option value="full">Vollpension</option>
          </select>
        </div>
        <div><label>Wert der Verpflegung je Person und Nacht (CHF, nur Halb-/Vollpension)</label><input name="mealChf" type="number" min={0} step="0.05" defaultValue={p ? p.mealRappen / 100 : 0} disabled={!canEdit} /></div>
      </div>
      <p className="muted small">Bei Halb-/Vollpension weist die Rechnung die Verpflegung zum Normalsatz aus (Beherbergung zum Sondersatz).</p>
      <label className="check"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} disabled={!canEdit} />Buchbar</label>
      {p ? <p className="muted small">Gast sieht: {cancellationPolicyText(p, "de")}</p> : <p className="muted small">Der Startpreis gilt für alle Tage der nächsten 18 Monate. Wochenend- oder Saisonpreise setzt du danach im Kalender.</p>}
      {canEdit ? <div className="drawer-actions"><button className="btn">{p ? "Speichern" : "Tarif anlegen"}</button><Link className="btn secondary" href={cancelHref} scroll={false}>Abbrechen</Link></div> : null}
    </form>
  );
}

type Tab = "grunddaten" | "fotos" | "tarife";
const TABS: { key: Tab; label: string }[] = [{ key: "grunddaten", label: "Grunddaten" }, { key: "fotos", label: "Fotos" }, { key: "tarife", label: "Tarife" }];

export default async function Rooms({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const list = await listRooms(hotel.id);
  const langs = hotelLocales(hotel);
  const left = translationsLeft(hotel);
  const base = `/mypontivo/${hotel.id}/rooms`;

  // Seitenleiste: ?rt=<id>&tab=grunddaten|fotos|tarife[&plan=<id>|neu], neuer Zimmertyp: ?neu=1
  const open = list.find((x) => x.roomType.id === sp.rt);
  const creating = canEdit && sp.neu === "1" && !open;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "grunddaten";
  const msgClass = sp.msg ? `notice ${sp.msg.startsWith("Nicht") || sp.msg.includes(":") ? "warn" : ""}` : "";
  const drawerOpen = !!open || creating;
  const at = (t: Tab, plan?: string) => `${base}?rt=${open?.roomType.id}&tab=${t}${plan ? `&plan=${plan}` : ""}`;
  const plan = open && tab === "tarife" && sp.plan ? (sp.plan === "neu" ? "neu" : open.plans.find((p) => p.id === sp.plan) ?? null) : null;

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Zimmer & Tarife</h1>
        {canEdit ? <Link className="btn" href={`${base}?neu=1`} scroll={false}>+ Zimmertyp hinzufügen</Link> : null}
      </div>
      {sp.msg && !drawerOpen ? <p className={msgClass}>{sp.msg}</p> : null}
      {hotel.channexEnabled ? <p className="notice warn small">Neue Zimmertypen oder Tarife zusätzlich auf der Seite «Channex» anlegen bzw. zuordnen, damit sie auch bei Booking.com erscheinen.</p> : null}

      {langs.length > 1 && canEdit && translationEnabled() ? (
        <form action={translateAll} className="inline-form" style={{ gap: 8 }}>
          <input type="hidden" name="hotelId" value={hotel.id} />
          <button className="btn secondary small" disabled={!left}>Fehlende Namen und Beschreibungen übersetzen (auch Zusatzleistungen)</button>
          <span className="small muted">aus dem Deutschen nach {langs.filter((l) => l !== "de").map((l) => l.toUpperCase()).join(", ")} · noch {left} diesen Monat</span>
        </form>
      ) : null}

      {list.length === 0 ? <p className="muted">Noch kein Zimmertyp.{canEdit ? " Legen Sie oben den ersten an." : ""}</p> : null}
      <ul className="rt-list">
        {list.map(({ roomType: rt, plans }) => (
          <li key={rt.id}>
            <Link className="card rt-card" href={`${base}?rt=${rt.id}&tab=grunddaten`} scroll={false} aria-label={`${rt.name} ${canEdit ? "bearbeiten" : "ansehen"}`}>
              {rt.photos[0] ? <img className="rt-thumb" src={rt.photos[0].url} alt="" loading="lazy" /> : <span className="rt-thumb rt-thumb-empty" aria-hidden="true" />}
              <span className="rt-title">
                <strong>{rt.name}</strong>
                <span className="muted small">{rt.roomCount} Zimmer · bis {rt.maxOccupancy} Personen</span>
                <span className="rt-chips">
                  {plans.map((p) => <span key={p.id} className={`chip${p.active ? "" : " off"}`}>{p.name}</span>)}
                </span>
              </span>
              {!rt.active ? <span className="rt-flag warn small">nicht buchbar</span> : plans.length === 0 ? <span className="rt-flag warn small">ohne Tarif</span> : null}
              <span className="rt-go" aria-hidden="true">{canEdit ? "Bearbeiten" : "Ansehen"} <span className="rt-arrow">›</span></span>
            </Link>
          </li>
        ))}
      </ul>

      {drawerOpen ? (
        <div className="drawer-wrap">
          <Link className="drawer-backdrop" href={base} scroll={false} aria-label="Schliessen" tabIndex={-1} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
            <header className="drawer-head">
              <h2 id="drawer-title">{open ? open.roomType.name : "Neuer Zimmertyp"}</h2>
              <Link className="drawer-close" href={base} scroll={false} aria-label="Schliessen">✕</Link>
            </header>
            {open ? (
              <nav className="drawer-tabs" aria-label="Bereiche des Zimmertyps">
                {TABS.map((t) => <Link key={t.key} href={at(t.key)} scroll={false} className={t.key === tab ? "on" : undefined} aria-current={t.key === tab ? "page" : undefined}>{t.label}{t.key === "tarife" ? ` (${open.plans.length})` : ""}</Link>)}
              </nav>
            ) : null}
            <div className="drawer-body stack">
              {sp.msg ? <p className={msgClass}>{sp.msg}</p> : null}
              {creating ? <RoomForm hotelId={hotel.id} canEdit={canEdit} langs={langs} cancelHref={base} nextOrder={list.reduce((m, x) => Math.max(m, x.roomType.sortOrder + 1), 0)} /> : null}
              {open && tab === "grunddaten" ? <RoomForm hotelId={hotel.id} rt={open.roomType} canEdit={canEdit} langs={langs} cancelHref={base} /> : null}
              {open && tab === "fotos" ? <PhotoManager hotelId={hotel.id} roomTypeId={open.roomType.id} photos={open.roomType.photos} canEdit={canEdit} page="rooms" alt="z. B. Doppelzimmer mit Seesicht" /> : null}
              {open && tab === "tarife" && !plan ? (
                <>
                  {open.plans.length === 0 ? <p className="notice warn small">Noch kein Tarif: ohne Tarif ist das Zimmer nicht buchbar.</p> : null}
                  <ul className="plan-list">
                    {open.plans.map((p) => (
                      <li key={p.id}>
                        <Link href={at("tarife", p.id)} scroll={false} className="plan-row" aria-label={`Tarif ${p.name} ${canEdit ? "bearbeiten" : "ansehen"}`}>
                          <span><strong>{p.name}</strong><br /><span className="muted small">{boardLabel(p.board)} · {p.freeCancelHours !== null ? `kostenlos stornierbar bis ${p.freeCancelHours / 24} Tag(e) vorher` : "nicht kostenlos stornierbar"}{p.active ? "" : " · nicht buchbar"}</span></span>
                          <span className="rt-arrow" aria-hidden="true">›</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {canEdit ? <div><Link className="btn secondary" href={at("tarife", "neu")} scroll={false}>+ Tarif hinzufügen</Link></div> : null}
                </>
              ) : null}
              {open && tab === "tarife" && plan ? (
                <>
                  <p className="small"><Link href={at("tarife")} scroll={false}>‹ Alle Tarife</Link></p>
                  <h3 style={{ margin: 0 }}>{plan === "neu" ? "Neuer Tarif" : plan.name}</h3>
                  <PlanForm hotelId={hotel.id} roomTypeId={open.roomType.id} p={plan === "neu" ? undefined : plan} canEdit={canEdit} langs={langs} cancelHref={at("tarife")} />
                </>
              ) : null}
            </div>
          </aside>
          <DrawerKeys closeHref={base} />
        </div>
      ) : null}
    </div>
  );
}
