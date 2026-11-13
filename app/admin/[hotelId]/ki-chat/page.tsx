import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { AiModuleError, aiModuleRow, aiUsageSummary, cancelAiChat, enableAiChat, offeredPlans, setAiBudget } from "@/src/services/ai-module";
import { moduleActiveOn } from "@/src/domain/ai-plan";
import { todayIn } from "@/src/domain/dates";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (hotelId: string, msg: string) => redirect(`/admin/${hotelId}/ki-chat?msg=${encodeURIComponent(msg)}`);

async function enable(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  let msg = "KI-Chat eingeschaltet. Er erscheint jetzt auf Ihrer Website.";
  try {
    if (f.get("accept") !== "on") throw new AiModuleError("Bitte bestätigen Sie Preis und Bedingungen.");
    await enableAiChat(c.hotel, s(f, "plan"), Number(s(f, "price")), c.actor);
  } catch (e) {
    if (!(e instanceof AiModuleError)) throw e;
    msg = `Nicht eingeschaltet: ${e.message}`;
  }
  back(c.hotel.id, msg);
}

async function cancel(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  await cancelAiChat(c.hotel, c.actor);
  back(c.hotel.id, "Gekündigt. Der Chat läuft noch bis Ende des Monats.");
}

async function budget(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  let msg = "Budget gespeichert";
  try {
    await setAiBudget(c.hotel, decimalToRappen(s(f, "budget").replace(/[^\d.]/g, "") || "0"), c.actor);
  } catch (e) {
    if (!(e instanceof AiModuleError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  back(c.hotel.id, msg);
}

export default async function AiChatPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const isOwner = atLeast(role, "owner");
  const m = await aiModuleRow(hotel.id);
  const today = todayIn(hotel.timezone);
  const running = moduleActiveOn(m.enabled, m.settings, today);
  const t = m.settings.terms;
  const usage = running ? await aiUsageSummary(hotel, today.slice(0, 7)) : null;
  const plans = await offeredPlans();
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const keyMissing = !env().ANTHROPIC_API_KEY;

  return (
    <div className="stack">
      <h1>KI-Chat</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}

      <section className="card stack">
        <h2>Ihr digitaler Assistent für Gäste</h2>
        <p>Der Chat beantwortet Fragen zu Ihrem Haus, rund um die Uhr und in mehreren Sprachen: vor der Buchung, während des Aufenthalts und danach. Er kennt nur das, was auf Ihrer Website steht (Zeiten, Zimmer, Restaurant, häufige Fragen, Ausflugstipps) und erfindet nichts.</p>
        <ul className="small">
          <li>Begleitet Gäste auch während des Aufenthalts: Frühstückszeiten, Öffnungszeiten, Anreise, Ausflugstipps, Restaurant.</li>
          <li>Spart Anrufe und Mails zu immer gleichen Fragen.</li>
          <li>Weiss er etwas nicht, leitet er die Frage als Anfrage an Sie weiter (mit Mitteilung auf dem Handy).</li>
          <li>Nennt keine Zimmerpreise und prüft keine Verfügbarkeit, sondern verweist auf die Suche. Er ändert keine Buchungen.</li>
          <li>Gesprächstexte werden nicht gespeichert, nur die Anzahl der Gespräche.</li>
        </ul>
      </section>

      {running && t ? (
        <>
          <section className="card stack">
            <h2>Eingeschaltet <span className="badge">{t.name}</span></h2>
            {m.settings.endsAt ? <p className="notice warn small">Gekündigt: Der Chat läuft noch bis {m.settings.endsAt.split("-").reverse().join(".")}. Danach wird er abgeschaltet und nichts mehr berechnet.</p> : null}
            <p className="small">{formatChf(t.priceRappen)} pro Monat (ohne MWST), {t.included} Gespräche inklusive. Abgerechnet wird zusammen mit der Plattformgebühr, über die hinterlegte Karte.{m.settings.freeMonth === today.slice(0, 7) ? " Der laufende Monat ist kostenlos." : ""}</p>
            {usage ? (
              <p>Diesen Monat: <strong>{usage.conversations}</strong> von {t.included} Gesprächen
                {usage.packs > 0 ? <>, davon {usage.packs} Zusatzpaket{usage.packs === 1 ? "" : "e"} ({formatChf(usage.packsRappen)})</> : null}.
                {usage.paused ? <span className="badge warn" style={{ marginLeft: 8 }}>Pause bis Monatsende</span> : null}</p>
            ) : null}
            {keyMissing ? <p className="notice warn small">Der Chat ist technisch noch nicht eingerichtet (API-Schlüssel fehlt). Bitte beim Betreiber melden.</p> : null}
          </section>

          {t.packSize > 0 ? (
            <section className="card stack">
              <h2>Bei Limit weiterlaufen</h2>
              <p className="small">Ist das Kontingent aufgebraucht, macht der Chat standardmässig Pause bis Monatsende. Wenn er weiterlaufen soll, buchen Sie bei Bedarf Zusatzpakete: <strong>{t.packSize} Gespräche für {formatChf(t.packPriceRappen)}</strong> (angebrochene Pakete zählen voll). Sie bestimmen ein Monatsbudget, mehr wird nie berechnet. 0 = Pause bei Limit.</p>
              <form action={budget} className="inline-form">
                {hidden}
                <div><label>Monatsbudget CHF</label><input name="budget" inputMode="decimal" defaultValue={((m.settings.overageBudgetRappen ?? 0) / 100).toFixed(0)} disabled={!isOwner} /></div>
                <button className="btn secondary small" disabled={!isOwner}>Speichern</button>
              </form>
              {(m.settings.overageBudgetRappen ?? 0) >= t.packPriceRappen ? <p className="muted small">Mit diesem Budget laufen höchstens {t.included + Math.floor((m.settings.overageBudgetRappen ?? 0) / t.packPriceRappen) * t.packSize} Gespräche pro Monat.</p> : null}
            </section>
          ) : null}

          {isOwner && !m.settings.endsAt ? (
            <section className="card stack">
              <h2>Kündigen</h2>
              <p className="small muted">Jederzeit möglich, wirkt zum Ende des laufenden Monats.</p>
              <form action={cancel}>{hidden}<button className="btn secondary small">Modul kündigen</button></form>
            </section>
          ) : null}
        </>
      ) : (
        <section className="card stack">
          <h2>Einschalten</h2>
          {!isOwner ? <p className="muted small">Nur die Inhaberin oder der Inhaber kann das Modul einschalten.</p> : null}
          {!hotel.billingPaymentMethodId ? (
            <p className="notice warn small">Für die Abrechnung brauchen wir eine hinterlegte Karte. Bitte zuerst unter <a href={`/admin/${hotel.id}/settings#karte`}>Einstellungen</a> eine Karte hinterlegen.</p>
          ) : null}
          {plans.map((p) => (
            <form key={p.code} action={enable} className="card stack">
              {hidden}
              <input type="hidden" name="plan" value={p.code} />
              <input type="hidden" name="price" value={p.priceRappen} />
              <h3>{p.name}: {formatChf(p.priceRappen)} pro Monat</h3>
              <p className="small">{p.includedConversations} Gespräche pro Monat inklusive.{p.packSize > 0 ? ` Bei Bedarf Zusatzpakete: ${p.packSize} Gespräche für ${formatChf(p.packPriceRappen)}, nur mit Ihrem Monatsbudget.` : ""} Preise ohne MWST. Der erste Monat ist kostenlos, danach monatlich kündbar.</p>
              <label className="check"><input type="checkbox" name="accept" /> Ich habe Preis und die <a href="/gastgeber-bedingungen" target="_blank">Bedingungen für Gastgeber</a> gelesen und bestätige die monatliche Abrechnung über die hinterlegte Karte.</label>
              <div><button className="btn" disabled={!isOwner || !hotel.billingPaymentMethodId}>Einschalten</button></div>
            </form>
          ))}
          {!plans.length ? <p className="muted small">Im Moment ist kein Tarif verfügbar.</p> : null}
        </section>
      )}
    </div>
  );
}
