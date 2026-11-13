import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireUser } from "@/src/auth/guard";
import { hotelsForUser } from "@/src/auth/session";
import { CANTONS, PROPERTY_LABEL, PROPERTY_TYPES, addHotelForUser } from "@/src/services/onboarding";
import { feePercentText } from "@/src/domain/fee";
import { rateLimit } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function create(f: FormData) {
  "use server";
  const user = await requireUser();
  const mine = await hotelsForUser(user.id);
  if (user.isPlatformAdmin || !mine.some((m) => m.role === "owner")) redirect("/admin");
  if (!rateLimit(`addhotel:${user.id}`, 5)) redirect("/admin/neu?error=" + encodeURIComponent("Zu viele Versuche. Bitte in einer Minute nochmals."));
  let id: string;
  try {
    const r = await addHotelForUser(user, {
      propertyType: s(f, "propertyType") as never, name: s(f, "name"), canton: s(f, "canton") as never, municipality: s(f, "municipality"),
      mode: s(f, "mode") === "booking_only" ? "booking_only" : "website", websiteUrl: s(f, "websiteUrl"), acceptTerms: f.get("terms") === "on" ? true : (false as never),
    });
    id = r.hotel.id;
  } catch (e) {
    if (e instanceof ZodError) redirect("/admin/neu?error=" + encodeURIComponent(e.issues.map((i) => i.message).join(" · ")));
    throw e;
  }
  redirect(`/admin/${id}/einrichten`);
}

export default async function NewHotel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const mine = await hotelsForUser(user.id);
  if (user.isPlatformAdmin || !mine.some((m) => m.role === "owner")) redirect("/admin");
  const sp = await searchParams;
  return (
    <main className="wrap admin-main">
      <h1>Weiteren Betrieb anlegen</h1>
      <p className="muted">Der neue Betrieb gehört zu Ihrem Konto ({user.email}), Sie wechseln jederzeit zwischen den Betrieben. Jeder Betrieb hat eigene Preise, Zahlungen und Abrechnung.</p>
      <form action={create} className="card stack">
        {sp.error ? <p className="notice warn" role="alert">{sp.error}</p> : null}
        <fieldset className="plain"><legend className="small muted">Was vermieten Sie?</legend>
          <div className="type-pick">{PROPERTY_TYPES.map((t, i) => <label key={t}><input type="radio" name="propertyType" value={t} defaultChecked={i === 0} required />{PROPERTY_LABEL[t]}</label>)}</div>
        </fieldset>
        <fieldset className="plain"><legend className="small muted">Brauchen Sie eine Website?</legend>
          <div className="mode-pick">
            <label><input type="radio" name="mode" value="website" defaultChecked /><span><strong>Ja, Website mit Buchung</strong></span></label>
            <label><input type="radio" name="mode" value="booking_only" /><span><strong>Nein, nur das Buchungssystem</strong></span></label>
          </div>
          <div className="mode-url"><label htmlFor="websiteUrl">Adresse Ihrer Website</label><input id="websiteUrl" name="websiteUrl" maxLength={300} placeholder="www.chalet-edelweiss.ch" inputMode="url" /></div>
        </fieldset>
        <div><label htmlFor="name">Name des Betriebs</label><input id="name" name="name" required maxLength={120} /></div>
        <div className="form-grid" style={{ marginTop: 0 }}>
          <div><label htmlFor="canton">Kanton</label><select id="canton" name="canton" required defaultValue=""><option value="" disabled>wählen</option>{CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label htmlFor="municipality">Gemeinde</label><input id="municipality" name="municipality" required maxLength={100} /></div>
        </div>
        <label className="check"><input type="checkbox" name="terms" required /><span>Ich akzeptiere die <a href="/gastgeber-bedingungen" target="_blank">Bedingungen für Gastgeber</a> ({feePercentText()} %, mindestens CHF 19 pro Monat und Betrieb).</span></label>
        <button className="btn">Betrieb anlegen und einrichten</button>
        <p className="small"><a href="/admin">Abbrechen</a></p>
      </form>
    </main>
  );
}
