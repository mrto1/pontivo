import { Notice } from "@/components/admin/Notice";
import { WeekdayPick } from "@/components/admin/WeekdayPick";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { feePercentText } from "@/src/domain/fee";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { billingReady } from "@/src/domain/platform-invoice";
import { atLeast } from "@/src/auth/session";
import {
  addUnit, bookingOnly, CANCEL_TEMPLATES, chooseModules, detectEmbed, goLiveFromWizard, markEmbedded, isWholeUnit, nextOpenStep, onboardingSteps, OnboardingError, PROPERTY_LABEL,
  goLiveRestaurant, isRestaurant, markSetupCompleteIfDone, quickTables, setArrivalInfo, setGuestInfo, unitWord, updateBasics, type StepKey,
} from "@/src/services/onboarding";
import { choicesFor, choiceOn } from "@/src/domain/module-choice";
import { WEEKDAYS_DE, hoursText, parseHoursText } from "@/src/domain/reservations";
import { getSettings, saveOpeningHours, saveSettings } from "@/src/services/reservations";
import { listItems, listTables, PosError } from "@/src/services/pos";
import { isOn } from "@/src/domain/modules";
import { moduleRows } from "@/src/services/modules";
import { setPreviousSoftware } from "@/src/services/migration";
import { confirmTouristTax } from "@/src/services/settings";
import { taxRuleFor } from "@/src/services/hotels";
import { listRooms, MAX_PHOTOS, RoomError } from "@/src/services/rooms";
import { PhotoGrid } from "@/components/admin/PhotoGrid";
import { photoAction } from "../photo-actions";
import { listExtras } from "@/src/services/extras";
import { setBillingMethod, startCardSetup } from "@/src/services/billing";
import { onboardingLink, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import { env } from "@/src/env";
import { publicBase } from "@/src/services/brand";
import { CopyBox } from "@/components/admin/CopyBox";
import { StripeOnboarding } from "@/components/admin/StripeOnboarding";
import QRCode from "qrcode";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

const chf = (v: string) => decimalToRappen((v || "0").replace(",", ".").replace(/'/g, "").replace(/\.?[–-]+$/, "") || "0");
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function errText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(" · ");
  if (e instanceof OnboardingError || e instanceof RoomError || e instanceof PosError) return e.message;
  if (e instanceof Error && /Betrag|Gemeinde|Wert|Stripe|Kurtaxe/.test(e.message)) return e.message;
  throw e;
}

/** Aktion ausführen, dann zum nächsten offenen Schritt (oder bei Fehler zurück zum gleichen) */
async function step(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<void>, min: "manager" | "owner" = "manager") {
  const c = await requireHotel(s(f, "hotelId"), min);
  const here = s(f, "step");
  try {
    await fn(c);
  } catch (e) {
    redirect(`/admin/${c.hotel.id}/einrichten?step=${here}&error=${encodeURIComponent(errText(e))}`);
  }
  let fresh = (await requireHotel(c.hotel.id, min)).hotel;
  if (isRestaurant(fresh.propertyType)) { await markSetupCompleteIfDone(fresh); fresh = (await requireHotel(c.hotel.id, min)).hotel; }
  revalidatePath(`/admin/${c.hotel.id}`, "layout"); // Chip und Banner in der Kopfzeile aktualisieren
  const stay = s(f, "stay") === "1";
  redirect(`/admin/${c.hotel.id}/einrichten?step=${stay ? here : nextOpenStep(await onboardingSteps(fresh))}&ok=1`);
}

async function saveBasics(f: FormData) {
  "use server";
  await step(f, ({ hotel, actor }) => updateBasics(hotel, {
    name: s(f, "name"), addressLine: s(f, "addressLine"), postalCode: s(f, "postalCode"), city: s(f, "city"), contactPhone: s(f, "phone"),
    checkinTime: s(f, "checkin"), checkoutTime: s(f, "checkout"), intro: s(f, "intro"),
  }, actor));
}

/** Restaurant (SPEC 20.1): Angaben ohne Check-in/out, dazu Öffnungszeiten (leer = Ruhetag; alles leer = keine Einschränkung) */
async function saveRestaurantBasics(f: FormData) {
  "use server";
  await step(f, async ({ hotel, actor }) => {
    await updateBasics(hotel, { name: s(f, "name"), addressLine: s(f, "addressLine"), postalCode: s(f, "postalCode"), city: s(f, "city"), contactPhone: s(f, "phone"), checkinTime: hotel.checkinTime.slice(0, 5), checkoutTime: hotel.checkoutTime.slice(0, 5), intro: s(f, "intro") }, actor);
    const hours: Record<string, { from: string; to: string }[]> = {};
    for (let d = 0; d < 7; d++) {
      const w = parseHoursText(s(f, `h${d}`));
      if (!w) throw new OnboardingError(`${WEEKDAYS_DE[d]}: bitte so schreiben: 11:30-14:00, 17:30-22:00 (leer = Ruhetag).`);
      hours[String(d)] = w;
    }
    await saveOpeningHours(hotel.id, Object.values(hours).some((w) => w.length) ? hours : null, actor);
  });
}

async function saveTablesStep(f: FormData) {
  "use server";
  await step(f, async ({ hotel, actor }) => { await quickTables(hotel, Number(s(f, "count")), Number(s(f, "seats")), actor); });
}

async function saveOnlineStep(f: FormData) {
  "use server";
  await step(f, async ({ hotel, actor }) => {
    const cur = await getSettings(hotel.id);
    const windows = [1, 2].flatMap((n) => (s(f, `from${n}`) && s(f, `to${n}`) ? [{ from: s(f, `from${n}`), to: s(f, `to${n}`) }] : []));
    await saveSettings(hotel.id, { ...cur, onlineEnabled: true, windows, capacity: Number(s(f, "capacity") || cur.capacity), maxParty: Number(s(f, "maxParty") || cur.maxParty) }, actor);
    // Konzept 7a Schritt 3: Reservation und Website sofort live, ohne auf Stripe zu warten
    try { await goLiveRestaurant(hotel, actor); } catch (e) { throw new OnboardingError(`Reservierung ist eingestellt, aber noch nicht online: ${(e as Error).message}`); }
  });
}

async function saveModules(f: FormData) {
  "use server";
  await step(f, async ({ hotel, actor }) => {
    const shown = choicesFor({ restaurant: isRestaurant(hotel.propertyType), wholeUnit: isWholeUnit(hotel.propertyType) });
    // Reines Restaurant: das Modul «restaurant» bleibt an
    await chooseModules(hotel, { ...Object.fromEntries(shown.flatMap((c) => c.modules.map((m) => [m, f.get(`c_${c.key}`) === "1"]))), ...(isRestaurant(hotel.propertyType) ? { restaurant: true } : {}) }, actor);
  });
}

async function saveUmstieg(f: FormData) {
  "use server";
  await step(f, ({ hotel, actor }) => setPreviousSoftware(hotel, s(f, "answer") === "yes" ? "yes" : "none", actor));
}

async function saveTax(f: FormData) {
  "use server";
  await step(f, async ({ hotel, actor }) => {
    const none = f.get("none") === "1";
    const reduced = s(f, "reduced");
    await confirmTouristTax(hotel, {
      adultRappen: none ? 0 : chf(s(f, "adult")), reducedRappen: none || !reduced ? null : chf(reduced),
      freeUnderAge: Number(s(f, "freeUnder") || 0), reducedUnderAge: none || !s(f, "reducedUnder") ? null : Number(s(f, "reducedUnder")),
      notes: none ? "Keine Kurtaxe (Angabe Gastgeber)" : "Angabe Gastgeber im Einrichtungs-Assistenten",
    }, actor);
  });
}

async function saveUnit(f: FormData) {
  "use server";
  await step(f, async ({ hotel, actor }) => {
    await addUnit(hotel, {
      name: s(f, "name"), description: s(f, "description"), count: Number(s(f, "count") || 1), maxPersons: Number(s(f, "maxPersons") || 2),
      priceRappen: chf(s(f, "price")), minNights: Number(s(f, "minNights") || 1), arrivalWeekdays: f.getAll("arrival").map(Number),
      cancel: s(f, "cancel") as never, breakfast: f.get("breakfast") === "on", cleaningRappen: chf(s(f, "cleaning")),
    }, actor);
  });
}

async function saveArrival(f: FormData) {
  "use server";
  await step(f, ({ hotel, actor }) => setArrivalInfo(hotel, { de: s(f, "de"), en: s(f, "en") }, actor));
}

async function saveGuestInfoAction(f: FormData) {
  "use server";
  await step(f, ({ hotel, actor }) => setGuestInfo(hotel, { de: s(f, "de"), en: s(f, "en") }, actor));
}

async function skip(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  redirect(`/admin/${c.hotel.id}/einrichten?step=${s(f, "to")}`);
}

async function stripeStart(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  let url = "";
  try {
    url = await onboardingLink(hotel, actor, `/admin/${hotel.id}/einrichten?step=zahlungen`);
  } catch (e) {
    redirect(`/admin/${hotel.id}/einrichten?step=zahlungen&error=${encodeURIComponent(`Stripe: ${(e as Error).message}`)}`);
  }
  redirect(url);
}

async function stripeReload(f: FormData) {
  "use server";
  await step(f, async ({ hotel }) => { await refreshAccountStatus(hotel); }, "owner");
}

async function cardStart(f: FormData) {
  "use server";
  const { hotel } = await requireHotel(s(f, "hotelId"), "owner");
  let url = "";
  try {
    url = await startCardSetup(hotel, `/admin/${hotel.id}/einrichten?step=karte`);
  } catch (e) {
    redirect(`/admin/${hotel.id}/einrichten?step=karte&error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(url);
}

async function chooseQr(f: FormData) {
  "use server";
  await step(f, ({ hotel, actor }) => setBillingMethod(hotel, "qr", actor), "owner");
}

async function embedCheck(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "manager");
  if (s(f, "confirm") === "1") {
    await markEmbedded(hotel, "confirmed", actor);
    redirect(`/admin/${hotel.id}/einrichten?step=einbinden`);
  }
  const found = await detectEmbed(hotel);
  if (found) await markEmbedded(hotel, "detected", actor);
  redirect(`/admin/${hotel.id}/einrichten?step=einbinden&${found ? "msg=" + encodeURIComponent("Gefunden: Ihre Website verweist auf die Buchung.") : "error=" + encodeURIComponent("Auf der Startseite Ihrer Website haben wir noch keinen Link zur Buchung gefunden. Ist die Änderung schon veröffentlicht?")}`);
}

async function goLive(f: FormData) {
  "use server";
  await step(f, ({ hotel, actor }) => goLiveFromWizard(hotel, actor), "owner");
}

export default async function Wizard({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "manager");
  const steps = await onboardingSteps(hotel);
  const current: StepKey = (steps.find((x) => x.key === sp.step)?.key) ?? nextOpenStep(steps);
  const idx = steps.findIndex((x) => x.key === current);
  const doneCount = steps.filter((x) => x.done).length;
  const isOwner = atLeast(role, "owner");
  const whole = isWholeUnit(hotel.propertyType);
  const onlyBooking = bookingOnly(hotel);
  const unit = unitWord(hotel.propertyType);
  const H = (
    <>
      <input type="hidden" name="hotelId" value={hotel.id} />
      <input type="hidden" name="step" value={current} />
    </>
  );
  const next = steps[idx + 1]?.key;
  const skipBtn = next ? (
    <form className="d-inline" action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn secondary">Später</button></form>
  ) : null;

  const resto = isRestaurant(hotel.propertyType);
  let body: React.ReactNode = null;
  switch (current) {
    case "betrieb":
      if (resto) {
        const cfg = await getSettings(hotel.id);
        body = (
          <form action={saveRestaurantBasics} className="stack">{H}
            <div><label htmlFor="name">Name des Betriebs (so erscheint er auf der Website)</label><input id="name" name="name" defaultValue={hotel.name} required /></div>
            <div className="form-grid">
              <div className="col-all"><label htmlFor="addressLine">Strasse und Nr.</label><input id="addressLine" name="addressLine" defaultValue={hotel.addressLine ?? ""} required autoComplete="street-address" /></div>
              <div><label htmlFor="postalCode">PLZ</label><input id="postalCode" name="postalCode" defaultValue={hotel.postalCode ?? ""} required inputMode="numeric" maxLength={4} /></div>
              <div><label htmlFor="city">Ort</label><input id="city" name="city" defaultValue={hotel.city ?? ""} required /></div>
              <div><label htmlFor="phone">Telefon für Gäste (optional)</label><input id="phone" name="phone" defaultValue={hotel.contactPhone ?? ""} type="tel" /></div>
            </div>
            <fieldset className="plain"><legend><strong>Öffnungszeiten</strong> <span className="small muted">z. B. 11:30-14:00, 17:30-22:00; leer = Ruhetag. Alles leer = ohne Einschränkung.</span></legend>
              <div className="form-grid">
                {[1, 2, 3, 4, 5, 6, 0].map((i) => <div key={i}><label htmlFor={`h${i}`}>{WEEKDAYS_DE[i]}</label><input id={`h${i}`} name={`h${i}`} defaultValue={hoursText(cfg.openingHours?.[String(i)])} placeholder="11:30-14:00, 17:30-22:00" /></div>)}
              </div>
            </fieldset>
            <div><label htmlFor="intro">Kurzbeschreibung für die Startseite (1–3 Sätze)</label>
              <textarea id="intro" name="intro" rows={3} maxLength={1000} defaultValue={hotel.content.de?.intro ?? ""} placeholder="z. B. Gemütliche Beiz mit Gartenterrasse, saisonale Küche aus der Region." /></div>
            <div><button className="btn">Speichern und weiter</button></div>
          </form>
        );
        break;
      }
      body = (
        <form action={saveBasics} className="stack">{H}
          <div><label htmlFor="name">Name des Betriebs (so erscheint er auf der Website)</label><input id="name" name="name" defaultValue={hotel.name} required /></div>
          <div className="form-grid">
            <div className="col-all"><label htmlFor="addressLine">Strasse und Nr.</label><input id="addressLine" name="addressLine" defaultValue={hotel.addressLine ?? ""} required autoComplete="street-address" /></div>
            <div><label htmlFor="postalCode">PLZ</label><input id="postalCode" name="postalCode" defaultValue={hotel.postalCode ?? ""} required inputMode="numeric" maxLength={4} /></div>
            <div><label htmlFor="city">Ort</label><input id="city" name="city" defaultValue={hotel.city ?? ""} required /></div>
            <div><label htmlFor="phone">Telefon für Gäste (optional)</label><input id="phone" name="phone" defaultValue={hotel.contactPhone ?? ""} type="tel" /></div>
          </div>
          <div className="form-grid">
            <div><label htmlFor="checkin">Check-in ab</label><input id="checkin" name="checkin" type="time" defaultValue={hotel.checkinTime.slice(0, 5)} required /></div>
            <div><label htmlFor="checkout">Check-out bis</label><input id="checkout" name="checkout" type="time" defaultValue={hotel.checkoutTime.slice(0, 5)} required /></div>
          </div>
          <div><label htmlFor="intro">{onlyBooking ? "Kurzbeschreibung für die Buchungsseite (1–3 Sätze)" : "Kurzbeschreibung für die Startseite (1–3 Sätze)"}</label>
            <textarea id="intro" name="intro" rows={3} maxLength={1000} defaultValue={hotel.content.de?.intro ?? ""} placeholder={whole ? "z. B. Gemütliche 3½-Zimmer-Wohnung mit Balkon und Bergsicht, 5 Minuten zur Gondelbahn." : "z. B. Familiengeführter Gasthof mit 12 Zimmern und Restaurant, mitten im Dorf."} /></div>
          <div><button className="btn">Speichern und weiter</button></div>
        </form>
      );
      break;
    case "funktionen": {
      const rows = await moduleRows(hotel.id);
      body = (
        <form action={saveModules} className="stack">{H}
          <p className="muted m0">Kreuzen Sie an, was auf Sie zutrifft. Alles andere bleibt ausgeblendet und lässt sich jederzeit unter «Funktionen» ändern.</p>
          {choicesFor({ restaurant: !!resto, wholeUnit: whole }).map((c) => (
            <label key={c.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
              <input className="w-auto-mt4" type="checkbox" name={`c_${c.key}`} value="1" defaultChecked={choiceOn(rows, c, isOn)} />
              <span>{c.question}{c.hint ? <span className="small muted block">{c.hint}</span> : null}</span>
            </label>
          ))}
          <div><button className="btn">Speichern und weiter</button></div>
        </form>
      );
      break;
    }
    case "tische": {
      const tables = await listTables(hotel.id);
      body = (
        <div className="stack">
          {tables.length ? <p className="notice">✓ {tables.length} Tische mit zusammen {tables.reduce((a, t) => a + t.seats, 0)} Plätzen. Plätze, Form und Lage im Plan ändern Sie unter <a href={`/admin/${hotel.id}/restaurant/tische`}>Tischplan</a>.</p> : null}
          <form action={saveTablesStep} className="stack">{H}
            {tables.length ? <input type="hidden" name="stay" value="1" /> : null}
            <p className="muted m0">Für den Anfang genügt die Zahl der Tische. Sie heissen «Tisch 1», «Tisch 2» …; Namen, Plätze und Lage passen Sie später im Tischplan an.</p>
            <div className="form-grid">
              <div><label htmlFor="count">Anzahl Tische</label><input id="count" name="count" type="number" min={1} max={100} defaultValue={tables.length ? 1 : 10} required /></div>
              <div><label htmlFor="seats">Plätze je Tisch</label><input id="seats" name="seats" type="number" min={1} max={50} defaultValue={4} required /></div>
            </div>
            <div><button className="btn">{tables.length ? "Weitere anlegen" : "Speichern und weiter"}</button></div>
          </form>
          {tables.length && next ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn">Weiter</button></form> : null}
        </div>
      );
      break;
    }
    case "speisekarte": {
      const items = await listItems(hotel.id, true);
      body = (
        <div className="stack">
          {items.length ? <p className="notice">✓ {items.length} Artikel auf der Speisekarte.</p> : null}
          <p>Ihre Speisekarte brauchen Website, Reservierung und später Online-Bestellung und Kasse. Drei Wege:</p>
          <ul className="list">
            <li><a href={`/admin/${hotel.id}/restaurant/artikel#ki`}><strong>Mit KI einlesen</strong></a>: Adresse Ihrer bisherigen Speisekarte oder PDF; Sie prüfen den Entwurf vor der Übernahme.</li>
            <li><a href={`/admin/${hotel.id}/restaurant/artikel`}><strong>CSV-Datei</strong></a> aus Excel oder Ihrer bisherigen Kasse.</li>
            <li><a href={`/admin/${hotel.id}/restaurant/artikel`}><strong>Von Hand</strong></a>, Artikel für Artikel.</li>
          </ul>
          {items.length && next ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn">Weiter</button></form> : skipBtn}
        </div>
      );
      break;
    }
    case "reservierung": {
      const cfg = await getSettings(hotel.id);
      const seats = (await listTables(hotel.id)).reduce((a, t) => a + t.seats, 0);
      const live = cfg.onlineEnabled && hotel.status === "live";
      const link = `${publicBase(hotel)}/${hotel.defaultLanguage}/tisch`;
      body = (
        <form action={saveOnlineStep} className="stack">{H}
          {live ? (
            <div className="notice stack" data-testid="reservation-live">
              <strong>✓ Reservierung ist online.</strong>
              <span>Link für Ihre Website, Google-Profil oder Social Media:</span>
              <CopyBox text={link} label="Link zur Reservierung" />
              <span className="small">QR-Code für Tischkarten, Schaufenster oder Flyer:</span>
              <img src={await QRCode.toDataURL(link, { margin: 1, width: 200 })} alt="QR-Code zur Tischreservierung" width={200} height={200} />
            </div>
          ) : null}
          <p>Gäste reservieren auf Ihrer Website, über einen Link oder QR-Code selbst und bekommen eine Bestätigung mit Storno-Link. Das geht sofort, ohne auf Stripe zu warten; die Anzahlung bleibt aus, bis Stripe freigegeben ist.</p>
          <p className="small muted m0">Zeitfenster, in denen ein Tisch beginnen kann (im Raster von 30 Minuten):</p>
          <div className="form-grid">
            {[1, 2].map((n) => { const w = cfg.windows[n - 1]; return (
              <div key={n} className="inline-form"><label htmlFor={`from${n}`}>{n === 1 ? "Mittag" : "Abend"} von</label><input id={`from${n}`} name={`from${n}`} type="time" defaultValue={w?.from ?? ""} /><label htmlFor={`to${n}`}>bis</label><input id={`to${n}`} name={`to${n}`} type="time" defaultValue={w?.to ?? ""} /></div>
            ); })}
          </div>
          <div className="form-grid">
            <div><label htmlFor="capacity">Plätze online (gleichzeitig)</label><input id="capacity" name="capacity" type="number" min={1} max={1000} defaultValue={cfg.onlineEnabled ? cfg.capacity : Math.max(1, seats || cfg.capacity)} /></div>
            <div><label htmlFor="maxParty">Grösste Gruppe online</label><input id="maxParty" name="maxParty" type="number" min={1} max={50} defaultValue={cfg.maxParty} /></div>
          </div>
          <p className="small muted">Anzahlung, Erinnerung, Warteliste und Vorlauf stellen Sie später unter <a href={`/admin/${hotel.id}/restaurant/einstellungen#online`}>Reservierung</a> ein.</p>
          <div style={{ display: "flex", gap: 8 }}><button className="btn">{live ? "Speichern und weiter" : "Reservation live schalten"}</button></div>
        </form>
      );
      break;
    }
    case "umstieg":
      body = (
        <form action={saveUmstieg} className="stack">{H}
          <p className="muted m0">Haben Sie bereits eine Hotelsoftware oder Buchungsverwaltung?</p>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
            <input className="w-auto-mt4" type="radio" name="answer" value="none" defaultChecked={hotel.onboarding.previousSoftware !== "yes"} />
            <span>Nein, ich starte neu mit Pontivo.</span>
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400 }}>
            <input className="w-auto-mt4" type="radio" name="answer" value="yes" defaultChecked={hotel.onboarding.previousSoftware === "yes"} />
            <span>Ja, ich wechsle von einer anderen Software und möchte meine Reservierungen übernehmen.</span>
          </label>
          <p className="small muted m0">Bei «Ja» läuft Ihre alte Software zunächst parallel weiter. Unter «Datenübernahme» finden Sie dann den Import, die Umschalt-Checkliste und Hinweise zum Parallelbetrieb.</p>
          <div><button className="btn">Speichern und weiter</button></div>
        </form>
      );
      break;
    case "kurtaxe": {
      const rule = await taxRuleFor(hotel, todayIn(hotel.timezone));
      const known = rule && rule.status !== "needs_confirmation" && rule.adultRappen !== null;
      body = (
        <div className="stack">
          <p>Die Kurtaxe wird Gästen bei der Buchung separat ausgewiesen und mitbezahlt. Gemeinde: <strong>{hotel.municipality}</strong>, Kanton {hotel.canton}.</p>
          {known ? (
            <div className="notice">
              Gefunden: {rule!.adultRappen ? <>CHF {(rule!.adultRappen / 100).toFixed(2)} pro erwachsene Person und Nacht{rule!.reducedRappen !== null && rule!.reducedUnderAge !== null ? `, CHF ${(rule!.reducedRappen / 100).toFixed(2)} unter ${rule!.reducedUnderAge} Jahren` : ""}{rule!.freeUnderAge ? `, frei unter ${rule!.freeUnderAge} Jahren` : ""}.</> : "keine Kurtaxe."}
              {rule!.notes ? <div className="small muted">{rule!.notes}</div> : null}
            </div>
          ) : <p className="notice warn">Für Ihre Gemeinde kennen wir den Satz noch nicht. Bitte tragen Sie ihn ein – er steht im Kurtaxenreglement der Gemeinde oder auf der Website der Tourismusorganisation.</p>}
          <details open={!known}>
            <summary>{known ? "Anderen Satz eintragen" : "Satz eintragen"}</summary>
            <form action={saveTax} className="stack mt12">{H}
              <div className="form-grid">
                <div><label htmlFor="f02041">Erwachsene, CHF pro Nacht</label><input id="f02041" name="adult" inputMode="decimal" required placeholder="3.50" /></div>
                <div><label htmlFor="f02042">Kinder frei unter (Jahren)</label><input id="f02042" name="freeUnder" type="number" min={0} max={18} defaultValue={6} /></div>
                <div><label htmlFor="f02043">Reduziert, CHF (optional)</label><input id="f02043" name="reduced" inputMode="decimal" /></div>
                <div><label htmlFor="f02044">Reduziert unter (Jahren, optional)</label><input id="f02044" name="reducedUnder" type="number" min={0} max={18} /></div>
              </div>
              <div><button className="btn">Satz bestätigen</button></div>
            </form>
            <form action={saveTax} className="mt8">{H}<input type="hidden" name="none" value="1" /><button className="btn secondary small">In meiner Gemeinde gibt es keine Kurtaxe</button></form>
          </details>
          {known ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value="unterkunft" /><button className="btn">Stimmt so, weiter</button></form> : null}
        </div>
      );
      break;
    }
    case "unterkunft": {
      const rooms = await listRooms(hotel.id);
      const ex = await listExtras(hotel.id);
      body = (
        <div className="stack">
          {!rooms.length ? <p className="notice small">Sie haben schon eine Website oder einen Prospekt? <a href={`/admin/${hotel.id}/ki-einrichten`}>Mit KI einen Entwurf erstellen lassen</a> (nach Abschluss des Abos, Sie prüfen alles vor der Übernahme).</p> : null}
          {rooms.length ? (
            <table className="table">
              <thead><tr><th>{whole ? unit : "Zimmertyp"}</th><th>{whole ? "Personen" : "Anzahl · Personen"}</th><th>Tarif</th></tr></thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.roomType.id}>
                    <td><strong>{r.roomType.name}</strong></td>
                    <td>{whole ? r.roomType.maxOccupancy : `${r.roomType.roomCount} × bis ${r.roomType.maxOccupancy}`}</td>
                    <td className="small">{r.plans.map((p) => `${p.name}${p.minNights > 1 ? ` · ab ${p.minNights} Nächten` : ""}${p.arrivalWeekdays.length ? ` · Anreise ${p.arrivalWeekdays.map((w) => WD[w]).join("/")}` : ""}`).join("; ") || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {ex.some((e) => e.mandatory) ? <p className="small muted">Im Preis enthalten: {ex.filter((e) => e.mandatory).map((e) => `${e.name.de} ${formatChf(e.priceRappen)}`).join(", ")}</p> : null}
          <details className="card" open={!rooms.length}>
            <summary><strong>{rooms.length ? (whole ? `Weitere ${unit} hinzufügen` : "Weiteren Zimmertyp hinzufügen") : (whole ? `${unit} erfassen` : "Zimmertyp erfassen")}</strong></summary>
            <form action={saveUnit} className="stack mt12">{H}
              {rooms.length ? <input type="hidden" name="stay" value="1" /> : null}
              <div className="form-grid">
                <div><label htmlFor="f02045">Name</label><input id="f02045" name="name" required placeholder={whole ? "z. B. Wohnung Säntisblick" : "z. B. Doppelzimmer"} /></div>
                {whole ? <input type="hidden" name="count" value="1" /> : <div><label htmlFor="f02046">Anzahl gleiche Zimmer</label><input id="f02046" name="count" type="number" min={1} max={200} defaultValue={1} required /></div>}
                <div><label htmlFor="f02047">Max. Personen</label><input id="f02047" name="maxPersons" type="number" min={1} max={30} defaultValue={whole ? 4 : 2} required /></div>
              </div>
              <div><label htmlFor="f02048">Beschreibung (optional)</label><textarea id="f02048" name="description" rows={3} maxLength={2000} placeholder={whole ? "Zimmer, Betten, Küche, Balkon, Parkplatz …" : "Bett, Grösse, Aussicht, Bad …"} /></div>
              <div className="form-grid">
                <div><label>Preis pro Nacht CHF{whole ? " (ganze Unterkunft)" : " (für 2 Personen)"}</label><input name="price" inputMode="decimal" required placeholder={whole ? "180" : "160"} /></div>
                <div><label htmlFor="f02049">Mindestaufenthalt (Nächte)</label><input id="f02049" name="minNights" type="number" min={1} max={60} defaultValue={whole ? 3 : 1} /></div>
                {whole ? <div><label htmlFor="f020410">Endreinigung CHF (im Preis ausgewiesen)</label><input id="f020410" name="cleaning" inputMode="decimal" placeholder="80" /></div> : null}
              </div>
              <fieldset className="plain"><legend className="small muted">Anreise nur an (keiner gewählt = jeder Tag)</legend>
                <WeekdayPick name="arrival" />
              </fieldset>
              <div><label htmlFor="f020411">Stornoregel</label><select id="f020411" name="cancel" defaultValue={whole ? "moderat" : "flexibel"}>{Object.entries(CANCEL_TEMPLATES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></div>
              {whole ? null : <label className="check"><input type="checkbox" name="breakfast" defaultChecked={hotel.propertyType !== "group_house"} />Frühstück im Preis inbegriffen</label>}
              <div><button className="btn">{rooms.length ? "Hinzufügen" : "Speichern und weiter"}</button></div>
            </form>
          </details>
          <p className="small muted">Saisonpreise, Wochenendzuschläge und gesperrte Tage später im <a href={`/admin/${hotel.id}/calendar`}>Kalender</a>; Hund, Parkplatz, Frühstück usw. unter <a href={`/admin/${hotel.id}/rooms/extras`}>Zusatzleistungen</a>.</p>
          {rooms.length ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value="fotos" /><button className="btn">Weiter zu den Fotos</button></form> : null}
        </div>
      );
      break;
    }
    case "fotos": {
      const rooms = await listRooms(hotel.id);
      const photos = hotel.content.photos ?? [];
      body = (
        <div className="stack">
          <p>Gute Fotos sind das Wichtigste für Buchungen. Das Titelbild (das erste Foto) erscheint gross auf der Startseite. Die Reihenfolge ändern Sie, indem Sie ein Foto an eine andere Stelle ziehen; mit dem roten ✕ entfernen Sie es. Querformat, hell, ohne Personen.</p>
          {photos.length ? <PhotoGrid key={photos.map((p) => p.url).join("|")} photos={photos} canEdit action={photoAction} hidden={{ hotelId: hotel.id, roomTypeId: "", page: "einrichten" }} /> : null}
          {photos.length < MAX_PHOTOS ? (
            <form action={`/api/admin/hotels/${hotel.id}/photos?from=wizard`} method="post" encType="multipart/form-data" className="stack card">
              <div><label htmlFor="f020412">Fotos hochladen (JPG, PNG, WebP, max. 8 MB, bis 3 aufs Mal)</label><input id="f020412" type="file" name="file" accept="image/jpeg,image/png,image/webp" multiple required /></div>
              {rooms.length > 1 ? (
                <div><label htmlFor="f020413">Gehört zu</label><select id="f020413" name="roomTypeId" defaultValue=""><option value="">{whole ? "Allgemein (Startseite)" : "Haus allgemein (Startseite)"}</option>{rooms.map((r) => <option key={r.roomType.id} value={r.roomType.id}>{r.roomType.name}</option>)}</select></div>
              ) : null}
              <div><button className="btn">Hochladen</button></div>
            </form>
          ) : null}
          {resto ? null : <p className="small muted">Fotos pro {whole ? unit : "Zimmer"} sortieren und ersetzen unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer</a>.</p>}
          {steps.find((x) => x.key === "fotos")!.done && next ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn">Weiter</button></form> : resto ? skipBtn : null}
        </div>
      );
      break;
    }
    case "ankunft": {
      // «Später» ist eine zweite Schaltfläche desselben Formulars (kein verschachteltes Formular)
      const skipFromArrival = async (f: FormData) => {
        "use server";
        const c = await requireHotel(s(f, "hotelId"), "manager");
        redirect(`/admin/${c.hotel.id}/einrichten?step=${next}`);
      };
      body = (
        <form action={saveArrival} className="stack">{H}
          <p>Diese Infos schicken wir dem Gast automatisch 3 Tage vor der Anreise per E-Mail – so müssen Sie nicht jedes Mal schreiben.</p>
          <div><label htmlFor="ai-de">Deutsch</label><textarea id="ai-de" name="de" rows={6} maxLength={2000} defaultValue={hotel.content.arrivalInfo?.de ?? ""}
            placeholder={whole ? "Schlüssel: Schlüsselbox neben der Haustür, Code 4711.\nParkplatz: Nr. 3 hinter dem Haus.\nWLAN: Chalet-Gast / Passwort bergluft24" : "Rezeption geöffnet 7–21 Uhr. Später? Rufen Sie uns an: 055 …\nParkplätze hinter dem Haus."} /></div>
          <div><label htmlFor="ai-en">Englisch (optional)</label><textarea id="ai-en" name="en" rows={4} maxLength={2000} defaultValue={hotel.content.arrivalInfo?.en ?? ""} /></div>
          <p className="small muted">Zugangscodes nur hier eintragen, nicht auf der Website – die Infos gehen nur an Gäste mit bestätigter Buchung.</p>
          <div style={{ display: "flex", gap: 8 }}><button className="btn">Speichern und weiter</button>{next ? <button className="btn secondary" formNoValidate formAction={skipFromArrival}>Später</button> : null}</div>
        </form>
      );
      body = (
        <div className="stack">
          {body}
          <form action={saveGuestInfoAction} className="stack card">{H}
            <h3>Infos für den Aufenthalt (Gästeportal)</h3>
            <p className="small muted">Frühstückszeiten, Hausregeln, Tipps in der Nähe. Der Gast sieht sie auf seiner Buchungsseite, sobald die Buchung bestätigt ist.</p>
            <div><label htmlFor="gi-de">Deutsch</label><textarea id="gi-de" name="de" rows={6} maxLength={4000} defaultValue={hotel.content.guestInfo?.de ?? ""} /></div>
            <div><label htmlFor="gi-en">Englisch (optional)</label><textarea id="gi-en" name="en" rows={4} maxLength={4000} defaultValue={hotel.content.guestInfo?.en ?? ""} /></div>
            <div><button className="btn secondary">Aufenthaltsinfos speichern</button></div>
          </form>
        </div>
      );
      break;
    }
    case "zahlungen":
      body = env().PAYMENT_PROVIDER !== "stripe" ? (
        <div className="stack"><p className="notice">Testbetrieb: Zahlungen werden simuliert, dieser Schritt ist erledigt.</p>{skipBtn}</div>
      ) : (
        <div className="stack">
          <p>Gäste bezahlen mit TWINT, Karte, Apple Pay oder Google Pay. Das Geld geht direkt auf Ihr eigenes Konto bei Stripe und wird Ihnen auf Ihr Bankkonto überwiesen. Dafür eröffnen Sie bei Stripe ein Konto (ca. 10 Minuten, Ausweis und IBAN bereithalten).</p>
          {resto ? <p className="small muted">Die Prüfung durch Stripe dauert meist 1–2 Werktage; Pontivo kann sie nicht beschleunigen. Solange blockiert sie nur Zahlungen (Anzahlung, später Online-Bestellung). Reservierung und Website laufen schon.</p> : null}
          {sp.stripe === "return" ? <p className="notice">Zurück von Stripe. Die Prüfung kann einige Minuten dauern.</p> : null}
          <p>Status: {hotel.stripeChargesEnabled ? <span className="badge">✓ Zahlungen möglich</span> : hotel.stripeAccountId ? <span className="badge warn">in Prüfung oder unvollständig</span> : <span className="badge warn">noch kein Konto</span>}</p>
          {isOwner && !hotel.stripeChargesEnabled && env().STRIPE_PUBLISHABLE_KEY && sp.stripe !== "return" ? (
            <StripeOnboarding hotelId={hotel.id} publishableKey={env().STRIPE_PUBLISHABLE_KEY!} privacyUrl={`${env().APP_BASE_URL}/datenschutz`} />
          ) : null}
          {isOwner ? (
            <div className="flex-wrap8">
              {hotel.stripeChargesEnabled ? null : <form action={stripeStart}>{H}<button className={env().STRIPE_PUBLISHABLE_KEY ? "btn secondary small" : "btn"}>{env().STRIPE_PUBLISHABLE_KEY ? "Lieber auf der Stripe-Seite einrichten" : hotel.stripeAccountId ? "Bei Stripe fortsetzen" : "Konto bei Stripe eröffnen"}</button></form>}
              {hotel.stripeAccountId ? <form action={stripeReload}>{H}<input type="hidden" name="stay" value={hotel.stripeChargesEnabled ? "" : "1"} /><button className={env().STRIPE_PUBLISHABLE_KEY && !hotel.stripeChargesEnabled ? "btn secondary small" : "btn secondary"}>Status prüfen</button></form> : null}
            </div>
          ) : <p className="small muted">Das Konto eröffnet die Inhaberin bzw. der Inhaber.</p>}
        </div>
      );
      break;
    case "karte":
      body = (
        <div className="stack">
          <p>{formatChf(hotel.monthlyMinimumRappen)} pro Monat ist die Mindestgebühr. Die {feePercentText(hotel.platformFeeBps)} % pro Direktbuchung werden damit verrechnet: Liegen sie in einem Monat darunter, verrechnen wir Anfang des Folgemonats nur die Differenz. Die Mindestgebühr gilt ab dem ersten vollen Monat nach dem Live-Gang.</p>
          <p>Sie haben zwei Wege, beide ohne Zusatzkosten:</p>
          <ul className="list">
            <li><strong>Karte</strong>: wird Anfang Monat automatisch belastet. Die Karte wird bei Stripe gespeichert, wir sehen nur Kartentyp und die letzten vier Ziffern. Jetzt wird nichts belastet.</li>
            <li><strong>QR-Rechnung</strong>: kommt Anfang Monat per Mail, Sie bezahlen sie im E-Banking. Geht sofort, ohne auf Stripe zu warten.</li>
          </ul>
          {hotel.billingMethod === "qr" ? <p className="notice" data-testid="billing-qr-chosen">✓ Gewählt: QR-Rechnung</p> : hotel.billingCardLabel ? <p className="notice">✓ Hinterlegt: {hotel.billingCardLabel}</p> : null}
          {isOwner ? (
            <div className="inline-form">
              {hotel.billingMethod !== "qr" || !hotel.billingCardLabel ? <form action={cardStart}>{H}<button className={hotel.billingMethod === "qr" ? "btn secondary" : "btn"}>{hotel.billingCardLabel ? "Andere Karte hinterlegen" : "Karte hinterlegen"}</button></form> : null}
              {hotel.billingMethod !== "qr" ? <form action={chooseQr}>{H}<input type="hidden" name="step" value="karte" /><button className="btn secondary">Per QR-Rechnung bezahlen</button></form> : null}
            </div>
          ) : <p className="small muted">Die Zahlungsart wählt die Inhaberin bzw. der Inhaber.</p>}
          {billingReady(hotel) && next ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn secondary">Weiter</button></form> : null}
        </div>
      );
      break;
    case "live": {
      const open = steps.filter((x) => x.required && !x.done && x.key !== "live");
      const preview = `/h/${hotel.slug}/de`;
      body = hotel.status === "live" && onlyBooking ? (
        <div className="stack">
          <p className="notice">✓ Die Buchung für {hotel.name} ist online.</p>
          <p>Letzter Schritt: auf Ihrer Website einen Link oder Knopf einbauen, damit Gäste zur Buchung kommen.</p>
          <p><a className="btn" href="?step=einbinden">Weiter zum Einbau</a> <a className="btn secondary" href={preview} target="_blank">Buchungsseite ansehen ↗</a></p>
        </div>
      ) : hotel.status === "live" ? (
        <div className="stack">
          <p className="notice">✓ {hotel.name} ist online und buchbar.</p>
          <p><a className="btn" href={preview} target="_blank">Website ansehen ↗</a> <a className="btn secondary" href={`/admin/${hotel.id}`}>Zu «Heute»</a></p>
          <p className="small muted">Nächste Schritte: Website gestalten unter <a href={`/admin/${hotel.id}/site`}>Website & Buchung</a>, Buchungsknopf auf Ihrer bisherigen Website einbinden ebenfalls dort, Link im Google-Unternehmensprofil eintragen.</p>
        </div>
      ) : (
        <div className="stack">
          <p>{onlyBooking ? "Ihre Buchungsseite ist vorbereitet. Schauen Sie sie an – danach mit einem Klick online gehen. Ihre eigene Website bleibt, wie sie ist." : "Ihre Website ist vorbereitet. Schauen Sie sie an – danach mit einem Klick online gehen."}</p>
          <p><a className="btn secondary" href={preview} target="_blank">{onlyBooking ? "Buchungsseite ansehen ↗" : "Vorschau ansehen ↗"}</a></p>
          {open.length ? (
            <div className="notice warn">Noch offen: {open.map((x, i) => <span key={x.key}>{i ? ", " : ""}<a href={`?step=${x.key}`}>{x.title}</a></span>)}</div>
          ) : isOwner ? (
            <form action={goLive}>{H}<button className="btn">Jetzt online gehen</button></form>
          ) : <p className="small muted">Online schalten kann die Inhaberin bzw. der Inhaber.</p>}
        </div>
      );
      break;
    }
    case "einbinden": {
      const link = `${publicBase(hotel)}/de`;
      const script = `${env().APP_BASE_URL}/widget/${hotel.slug}.js`;
      const button = `<div data-pontivo="${hotel.slug}" data-mode="button"></div>\n<script src="${script}" async></script>`;
      const own = hotel.content.brand?.websiteUrl ?? "";
      body = (
        <div className="stack">
          {hotel.onboarding.embeddedAt ? <p className="notice">✓ Erledigt. Gäste kommen von {own.replace(/^https?:\/\//, "")} zur Buchung.</p> : null}
          <p>Ihre Website <a href={own} target="_blank" rel="noreferrer">{own.replace(/^https?:\/\//, "")}</a> bleibt, wie sie ist. Damit Gäste direkt buchen, braucht es dort einen Link oder Knopf. Wählen Sie, was für Sie einfacher ist:</p>
          <h3>1. Link beim Menüpunkt «Buchen» eintragen (am einfachsten)</h3>
          <p className="small muted">Funktioniert mit jedem Baukasten (Wix, Jimdo, WordPress, Squarespace …). Falls Ihre Seite schon einen Knopf «Buchen» oder «Anfragen» hat: dort diese Adresse eintragen.</p>
          <CopyBox text={link} label="Link zur Buchungsseite" />
          <h3>2. Knopf «Jetzt buchen» einfügen</h3>
          <p className="small muted">Code in einen «HTML»- oder «Code»-Block einfügen. Weitere Varianten (Suchleiste mit Daten) unter <a href={`/admin/${hotel.id}/site#einbinden`}>Website & Buchung</a>.</p>
          <CopyBox text={button} label="Code für den Knopf" />
          <h3>3. Jemand anderes macht Ihre Website?</h3>
          <p className="small muted">Schicken Sie diese Seite oder den Link oben an Ihre Webagentur – mehr braucht es nicht.</p>
          {hotel.status !== "live" ? <p className="notice warn small">Noch nicht online: Gäste sehen auf der Buchungsseite einen Hinweis statt Angeboten.</p> : null}
          <div className="flex-wrap8">
            <form action={embedCheck}>{H}<button className="btn">Meine Website prüfen</button></form>
            {hotel.onboarding.embeddedAt ? null : <form action={embedCheck}>{H}<input type="hidden" name="confirm" value="1" /><button className="btn secondary">Ist eingebaut</button></form>}
            {hotel.onboarding.embeddedAt ? <a className="btn secondary" href={`/admin/${hotel.id}`}>Zu «Heute»</a> : null}
          </div>
        </div>
      );
      break;
    }
  }

  return (
    <div className="wizard">
      <aside className="wizard-steps" aria-label="Schritte">
        <p className="small muted" style={{ margin: "0 0 8px" }}>{PROPERTY_LABEL[hotel.propertyType]} · {doneCount} von {steps.length} erledigt</p>
        <div className="wizard-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
        <ol>
          {steps.map((x) => (
            <li key={x.key} aria-current={x.key === current ? "step" : undefined} className={x.done ? "done" : ""}>
              <a href={`?step=${x.key}`}><span className="dot" aria-hidden="true">{x.done ? "✓" : ""}</span>{x.title}{x.required ? "" : <span className="muted small"> (optional)</span>}</a>
            </li>
          ))}
        </ol>
      </aside>
      <section className="card wizard-main">
        <h1 style={{ fontSize: "1.6rem" }}>{steps[idx].title}</h1>
        {sp.error ? <p className="notice warn" role="alert">{sp.error}</p> : null}
        {sp.msg ? <Notice text={sp.msg} /> : null}
        {body}
      </section>
    </div>
  );
}
