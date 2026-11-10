import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import {
  addUnit, bookingOnly, CANCEL_TEMPLATES, detectEmbed, goLiveFromWizard, markEmbedded, isWholeUnit, nextOpenStep, onboardingSteps, OnboardingError, PROPERTY_LABEL,
  setArrivalInfo, unitWord, updateBasics, type StepKey,
} from "@/src/services/onboarding";
import { confirmTouristTax } from "@/src/services/settings";
import { taxRuleFor } from "@/src/services/hotels";
import { listRooms, MAX_PHOTOS, RoomError } from "@/src/services/rooms";
import { listExtras } from "@/src/services/extras";
import { startCardSetup } from "@/src/services/billing";
import { onboardingLink, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import { env } from "@/src/env";
import { publicBase } from "@/src/services/brand";
import { CopyBox } from "@/components/admin/CopyBox";
import { StripeOnboarding } from "@/components/admin/StripeOnboarding";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const chf = (v: string) => decimalToRappen((v || "0").replace(",", ".").replace(/'/g, "").replace(/\.?[–-]+$/, "") || "0");
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function errText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(" · ");
  if (e instanceof OnboardingError || e instanceof RoomError) return e.message;
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
  const fresh = (await requireHotel(c.hotel.id, min)).hotel;
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
    <form action={skip} style={{ display: "inline" }}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn secondary small">Später</button></form>
  ) : null;

  let body: React.ReactNode = null;
  switch (current) {
    case "betrieb":
      body = (
        <form action={saveBasics} className="stack">{H}
          <div><label htmlFor="name">Name des Betriebs (so erscheint er auf der Website)</label><input id="name" name="name" defaultValue={hotel.name} required /></div>
          <div className="form-grid">
            <div style={{ gridColumn: "1 / -1" }}><label htmlFor="addressLine">Strasse und Nr.</label><input id="addressLine" name="addressLine" defaultValue={hotel.addressLine ?? ""} required autoComplete="street-address" /></div>
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
            <form action={saveTax} className="stack" style={{ marginTop: 12 }}>{H}
              <div className="form-grid">
                <div><label>Erwachsene, CHF pro Nacht</label><input name="adult" inputMode="decimal" required placeholder="3.50" /></div>
                <div><label>Kinder frei unter (Jahren)</label><input name="freeUnder" type="number" min={0} max={18} defaultValue={6} /></div>
                <div><label>Reduziert, CHF (optional)</label><input name="reduced" inputMode="decimal" /></div>
                <div><label>Reduziert unter (Jahren, optional)</label><input name="reducedUnder" type="number" min={0} max={18} /></div>
              </div>
              <div><button className="btn">Satz bestätigen</button></div>
            </form>
            <form action={saveTax} style={{ marginTop: 8 }}>{H}<input type="hidden" name="none" value="1" /><button className="btn secondary small">In meiner Gemeinde gibt es keine Kurtaxe</button></form>
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
            <form action={saveUnit} className="stack" style={{ marginTop: 12 }}>{H}
              {rooms.length ? <input type="hidden" name="stay" value="1" /> : null}
              <div className="form-grid">
                <div><label>Name</label><input name="name" required placeholder={whole ? "z. B. Wohnung Säntisblick" : "z. B. Doppelzimmer"} /></div>
                {whole ? <input type="hidden" name="count" value="1" /> : <div><label>Anzahl gleiche Zimmer</label><input name="count" type="number" min={1} max={200} defaultValue={1} required /></div>}
                <div><label>Max. Personen</label><input name="maxPersons" type="number" min={1} max={30} defaultValue={whole ? 4 : 2} required /></div>
              </div>
              <div><label>Beschreibung (optional)</label><textarea name="description" rows={3} maxLength={2000} placeholder={whole ? "Zimmer, Betten, Küche, Balkon, Parkplatz …" : "Bett, Grösse, Aussicht, Bad …"} /></div>
              <div className="form-grid">
                <div><label>Preis pro Nacht CHF{whole ? " (ganze Unterkunft)" : " (für 2 Personen)"}</label><input name="price" inputMode="decimal" required placeholder={whole ? "180" : "160"} /></div>
                <div><label>Mindestaufenthalt (Nächte)</label><input name="minNights" type="number" min={1} max={60} defaultValue={whole ? 3 : 1} /></div>
                {whole ? <div><label>Endreinigung CHF (im Preis ausgewiesen)</label><input name="cleaning" inputMode="decimal" placeholder="80" /></div> : null}
              </div>
              <fieldset className="plain"><legend className="small muted">Anreise nur an (keiner gewählt = jeder Tag)</legend>
                <div className="weekdays">{[1, 2, 3, 4, 5, 6, 0].map((w) => <label key={w}><input type="checkbox" name="arrival" value={w} />{WD[w]}</label>)}</div>
              </fieldset>
              <div><label>Stornoregel</label><select name="cancel" defaultValue={whole ? "moderat" : "flexibel"}>{Object.entries(CANCEL_TEMPLATES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></div>
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
          <p>Gute Fotos sind das Wichtigste für Buchungen. Das erste Foto erscheint gross auf der Startseite. Querformat, hell, ohne Personen.</p>
          {photos.length ? <div className="photo-grid">{photos.map((p, i) => <figure key={p.url} className="photo"><img src={p.url} alt={p.alt ?? ""} />{i === 0 ? <span className="badge">Titelbild</span> : null}</figure>)}</div> : null}
          {photos.length < MAX_PHOTOS ? (
            <form action={`/api/admin/hotels/${hotel.id}/photos?from=wizard`} method="post" encType="multipart/form-data" className="stack card">
              <div><label>Fotos hochladen (JPG, PNG, WebP, max. 8 MB, bis 3 aufs Mal)</label><input type="file" name="file" accept="image/jpeg,image/png,image/webp" multiple required /></div>
              {rooms.length > 1 ? (
                <div><label>Gehört zu</label><select name="roomTypeId" defaultValue=""><option value="">{whole ? "Allgemein (Startseite)" : "Haus allgemein (Startseite)"}</option>{rooms.map((r) => <option key={r.roomType.id} value={r.roomType.id}>{r.roomType.name}</option>)}</select></div>
              ) : null}
              <div><button className="btn">Hochladen</button></div>
            </form>
          ) : null}
          <p className="small muted">Fotos pro {whole ? unit : "Zimmer"} sortieren und ersetzen unter <a href={`/admin/${hotel.id}/rooms`}>Zimmer</a>.</p>
          {steps.find((x) => x.key === "fotos")!.done ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value="ankunft" /><button className="btn">Weiter</button></form> : null}
        </div>
      );
      break;
    }
    case "ankunft":
      body = (
        <form action={saveArrival} className="stack">{H}
          <p>Diese Infos schicken wir dem Gast automatisch 3 Tage vor der Anreise per E-Mail – so müssen Sie nicht jedes Mal schreiben.</p>
          <div><label htmlFor="ai-de">Deutsch</label><textarea id="ai-de" name="de" rows={6} maxLength={2000} defaultValue={hotel.content.arrivalInfo?.de ?? ""}
            placeholder={whole ? "Schlüssel: Schlüsselbox neben der Haustür, Code 4711.\nParkplatz: Nr. 3 hinter dem Haus.\nWLAN: Chalet-Gast / Passwort bergluft24" : "Rezeption geöffnet 7–21 Uhr. Später? Rufen Sie uns an: 055 …\nParkplätze hinter dem Haus."} /></div>
          <div><label htmlFor="ai-en">Englisch (optional)</label><textarea id="ai-en" name="en" rows={4} maxLength={2000} defaultValue={hotel.content.arrivalInfo?.en ?? ""} /></div>
          <p className="small muted">Zugangscodes nur hier eintragen, nicht auf der Website – die Infos gehen nur an Gäste mit bestätigter Buchung.</p>
          <div style={{ display: "flex", gap: 8 }}><button className="btn">Speichern und weiter</button>{skipBtn}</div>
        </form>
      );
      break;
    case "zahlungen":
      body = env().PAYMENT_PROVIDER !== "stripe" ? (
        <div className="stack"><p className="notice">Testbetrieb: Zahlungen werden simuliert, dieser Schritt ist erledigt.</p>{skipBtn}</div>
      ) : (
        <div className="stack">
          <p>Gäste bezahlen mit TWINT, Karte, Apple Pay oder Google Pay. Das Geld geht direkt auf Ihr eigenes Konto bei Stripe und wird Ihnen auf Ihr Bankkonto überwiesen. Dafür eröffnen Sie bei Stripe ein Konto (ca. 10 Minuten, Ausweis und IBAN bereithalten).</p>
          {sp.stripe === "return" ? <p className="notice">Zurück von Stripe. Die Prüfung kann einige Minuten dauern.</p> : null}
          <p>Status: {hotel.stripeChargesEnabled ? <span className="badge">✓ Zahlungen möglich</span> : hotel.stripeAccountId ? <span className="badge warn">in Prüfung oder unvollständig</span> : <span className="badge warn">noch kein Konto</span>}</p>
          {isOwner && !hotel.stripeChargesEnabled && env().STRIPE_PUBLISHABLE_KEY && sp.stripe !== "return" ? (
            <StripeOnboarding hotelId={hotel.id} publishableKey={env().STRIPE_PUBLISHABLE_KEY!} privacyUrl={`${env().APP_BASE_URL}/datenschutz`} />
          ) : null}
          {isOwner ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {hotel.stripeChargesEnabled ? null : <form action={stripeStart}>{H}<button className={env().STRIPE_PUBLISHABLE_KEY ? "btn secondary small" : "btn"}>{env().STRIPE_PUBLISHABLE_KEY ? "Lieber auf der Stripe-Seite einrichten" : hotel.stripeAccountId ? "Bei Stripe fortsetzen" : "Konto bei Stripe eröffnen"}</button></form>}
              {hotel.stripeAccountId ? <form action={stripeReload}>{H}<input type="hidden" name="stay" value={hotel.stripeChargesEnabled ? "" : "1"} /><button className="btn secondary">Status prüfen</button></form> : null}
            </div>
          ) : <p className="small muted">Das Konto eröffnet die Inhaberin bzw. der Inhaber.</p>}
        </div>
      );
      break;
    case "karte":
      body = (
        <div className="stack">
          <p>{formatChf(hotel.monthlyMinimumRappen)} pro Monat ist die Mindestgebühr. Die 1 % pro Direktbuchung werden damit verrechnet: Liegen sie in einem Monat darunter, belasten wir Anfang des Folgemonats nur die Differenz. Die Mindestgebühr gilt ab dem ersten vollen Monat nach dem Live-Gang.</p>
          <p>Die Karte wird bei Stripe gespeichert, wir sehen nur Kartentyp und die letzten vier Ziffern. Jetzt wird nichts belastet.</p>
          {hotel.billingCardLabel ? <p className="notice">✓ Hinterlegt: {hotel.billingCardLabel}</p> : null}
          {isOwner ? <form action={cardStart}>{H}<button className="btn">{hotel.billingCardLabel ? "Andere Karte hinterlegen" : "Karte hinterlegen"}</button></form> : <p className="small muted">Die Karte hinterlegt die Inhaberin bzw. der Inhaber.</p>}
          {hotel.billingCardLabel && next ? <form action={skip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="to" value={next} /><button className="btn secondary">Weiter</button></form> : null}
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
          <p><a className="btn" href={preview} target="_blank">Website ansehen ↗</a> <a className="btn secondary" href={`/admin/${hotel.id}`}>Zur Übersicht</a></p>
          <p className="small muted">Nächste Schritte: Website gestalten unter <a href={`/admin/${hotel.id}/site`}>Website</a>, Buchungsknopf auf Ihrer bisherigen Website einbinden unter <a href={`/admin/${hotel.id}/embed`}>Einbinden</a>, Link im Google-Unternehmensprofil eintragen.</p>
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
          <p className="small muted">Code in einen «HTML»- oder «Code»-Block einfügen. Weitere Varianten (Suchleiste mit Daten) unter <a href={`/admin/${hotel.id}/embed`}>Einbinden</a>.</p>
          <CopyBox text={button} label="Code für den Knopf" />
          <h3>3. Jemand anderes macht Ihre Website?</h3>
          <p className="small muted">Schicken Sie diese Seite oder den Link oben an Ihre Webagentur – mehr braucht es nicht.</p>
          {hotel.status !== "live" ? <p className="notice warn small">Noch nicht online: Gäste sehen auf der Buchungsseite einen Hinweis statt Angeboten.</p> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={embedCheck}>{H}<button className="btn">Meine Website prüfen</button></form>
            {hotel.onboarding.embeddedAt ? null : <form action={embedCheck}>{H}<input type="hidden" name="confirm" value="1" /><button className="btn secondary">Ist eingebaut</button></form>}
            {hotel.onboarding.embeddedAt ? <a className="btn secondary" href={`/admin/${hotel.id}`}>Zur Übersicht</a> : null}
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
        {sp.msg ? <p className="notice">{sp.msg}</p> : null}
        {body}
      </section>
    </div>
  );
}
