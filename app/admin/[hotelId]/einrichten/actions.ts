"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireHotel } from "@/src/auth/guard";
import {
  addUnit, chooseModules, detectEmbed, goLiveFromWizard, markEmbedded, isWholeUnit, nextOpenStep, onboardingSteps, OnboardingError,
  goLiveRestaurant, isRestaurant, markSetupCompleteIfDone, quickTables, setArrivalInfo, setGuestInfo, updateBasics,
} from "@/src/services/onboarding";
import { choicesFor } from "@/src/domain/module-choice";
import { WEEKDAYS_DE, parseHoursText } from "@/src/domain/reservations";
import { getSettings, saveOpeningHours, saveSettings } from "@/src/services/reservations";
import { setPreviousSoftware } from "@/src/services/migration";
import { confirmTouristTax } from "@/src/services/settings";
import { setBillingMethod, startCardSetup } from "@/src/services/billing";
import { onboardingLink, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";
import { decimalToRappen } from "@/src/domain/money";
import { userErrorText } from "@/src/lib/hotel-action";
import { s } from "@/src/lib/form";

/** Aktionen des Einrichtungs-Assistenten: speichern, dann zum nächsten offenen Schritt */

const chf = (v: string) => decimalToRappen((v || "0").replace(",", ".").replace(/'/g, "").replace(/\.?[–-]+$/, "") || "0");

function errText(e: unknown): string {
  const t = userErrorText(e);
  if (t === null) throw e;
  return t;
}

/** Aktion ausführen, dann zum nächsten offenen Schritt (oder bei Fehler zurück zum gleichen) */
async function step(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<void>, min: "manager" | "owner" = "manager") {
  const c = await requireHotel(s(f, "hotelId"), min);
  const here = s(f, "step");
  try {
    await fn(c);
  } catch (e) {
    const reopen = /^[a-z]+$/.test(s(f, "drawer")) ? `&${s(f, "drawer")}=1` : ""; // Seitenleiste bleibt bei einem Fehler offen
    redirect(`/admin/${c.hotel.id}/einrichten?step=${here}${reopen}&error=${encodeURIComponent(errText(e))}`);
  }
  let fresh = (await requireHotel(c.hotel.id, min)).hotel;
  if (isRestaurant(fresh.propertyType)) { await markSetupCompleteIfDone(fresh); fresh = (await requireHotel(c.hotel.id, min)).hotel; }
  revalidatePath(`/admin/${c.hotel.id}`, "layout"); // Chip und Banner in der Kopfzeile aktualisieren
  const stay = s(f, "stay") === "1";
  redirect(`/admin/${c.hotel.id}/einrichten?step=${stay ? here : nextOpenStep(await onboardingSteps(fresh))}&ok=1`);
}

export async function saveBasics(f: FormData) {
  await step(f, ({ hotel, actor }) => updateBasics(hotel, {
    name: s(f, "name"), addressLine: s(f, "addressLine"), postalCode: s(f, "postalCode"), city: s(f, "city"), contactPhone: s(f, "phone"),
    checkinTime: s(f, "checkin"), checkoutTime: s(f, "checkout"),
  }, actor));
}

/** Restaurant (SPEC 20.1): Angaben ohne Check-in/out, dazu Öffnungszeiten (leer = Ruhetag; alles leer = keine Einschränkung) */
export async function saveRestaurantBasics(f: FormData) {
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

export async function saveTablesStep(f: FormData) {
  await step(f, async ({ hotel, actor }) => { await quickTables(hotel, Number(s(f, "count")), Number(s(f, "seats")), actor); });
}

export async function saveOnlineStep(f: FormData) {
  await step(f, async ({ hotel, actor }) => {
    const cur = await getSettings(hotel.id);
    const windows = [1, 2].flatMap((n) => (s(f, `from${n}`) && s(f, `to${n}`) ? [{ from: s(f, `from${n}`), to: s(f, `to${n}`) }] : []));
    await saveSettings(hotel.id, { ...cur, onlineEnabled: true, windows, capacity: Number(s(f, "capacity") || cur.capacity), maxParty: Number(s(f, "maxParty") || cur.maxParty) }, actor);
    // Konzept 7a Schritt 3: Reservation und Website sofort live, ohne auf Stripe zu warten
    try { await goLiveRestaurant(hotel, actor); } catch (e) { throw new OnboardingError(`Reservation ist eingestellt, aber noch nicht online: ${(e as Error).message}`); }
  });
}

export async function saveModules(f: FormData) {
  await step(f, async ({ hotel, actor }) => {
    const shown = choicesFor({ restaurant: isRestaurant(hotel.propertyType), wholeUnit: isWholeUnit(hotel.propertyType) });
    // Reines Restaurant: das Modul «restaurant» bleibt an
    await chooseModules(hotel, { ...Object.fromEntries(shown.flatMap((c) => c.modules.map((m) => [m, f.get(`c_${c.key}`) === "1"]))), ...(isRestaurant(hotel.propertyType) ? { restaurant: true } : {}) }, actor);
  });
}

export async function saveUmstieg(f: FormData) {
  await step(f, ({ hotel, actor }) => setPreviousSoftware(hotel, s(f, "answer") === "yes" ? "yes" : "none", actor));
}

export async function saveTax(f: FormData) {
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

export async function saveUnit(f: FormData) {
  await step(f, async ({ hotel, actor }) => {
    await addUnit(hotel, {
      name: s(f, "name"), description: s(f, "description"), count: Number(s(f, "count") || 1), maxPersons: Number(s(f, "maxPersons") || 2),
      priceRappen: chf(s(f, "price")), minNights: Number(s(f, "minNights") || 1), arrivalWeekdays: f.getAll("arrival").map(Number),
      cancel: s(f, "cancel") as never, breakfast: f.get("breakfast") === "on", cleaningRappen: chf(s(f, "cleaning")),
    }, actor);
  });
}

export async function saveArrival(f: FormData) {
  await step(f, ({ hotel, actor }) => setArrivalInfo(hotel, { de: s(f, "de"), en: s(f, "en") }, actor));
}

export async function saveGuestInfoAction(f: FormData) {
  await step(f, ({ hotel, actor }) => setGuestInfo(hotel, { de: s(f, "de"), en: s(f, "en") }, actor));
}

export async function skip(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  redirect(`/admin/${c.hotel.id}/einrichten?step=${s(f, "to")}`);
}

export async function stripeStart(f: FormData) {
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  let url = "";
  try {
    url = await onboardingLink(hotel, actor, `/admin/${hotel.id}/einrichten?step=zahlungen`);
  } catch (e) {
    redirect(`/admin/${hotel.id}/einrichten?step=zahlungen&error=${encodeURIComponent(`Stripe: ${(e as Error).message}`)}`);
  }
  redirect(url);
}

export async function stripeReload(f: FormData) {
  await step(f, async ({ hotel }) => { await refreshAccountStatus(hotel); }, "owner");
}

export async function cardStart(f: FormData) {
  const { hotel } = await requireHotel(s(f, "hotelId"), "owner");
  let url = "";
  try {
    url = await startCardSetup(hotel, `/admin/${hotel.id}/einrichten?step=karte`);
  } catch (e) {
    redirect(`/admin/${hotel.id}/einrichten?step=karte&error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(url);
}

export async function chooseQr(f: FormData) {
  await step(f, ({ hotel, actor }) => setBillingMethod(hotel, "qr", actor), "owner");
}

export async function embedCheck(f: FormData) {
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "manager");
  if (s(f, "confirm") === "1") {
    await markEmbedded(hotel, "confirmed", actor);
    redirect(`/admin/${hotel.id}/einrichten?step=einbinden`);
  }
  const found = await detectEmbed(hotel);
  if (found) await markEmbedded(hotel, "detected", actor);
  redirect(`/admin/${hotel.id}/einrichten?step=einbinden&${found ? "msg=" + encodeURIComponent("Gefunden: Ihre Website verweist auf die Buchung.") : "error=" + encodeURIComponent("Auf der Startseite Ihrer Website haben wir noch keinen Link zur Buchung gefunden. Ist die Änderung schon veröffentlicht?")}`);
}

export async function goLive(f: FormData) {
  await step(f, ({ hotel, actor }) => goLiveFromWizard(hotel, actor), "owner");
}
