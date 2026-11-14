import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { saveMailTexts } from "@/src/services/mail-texts";
import { isMailTemplate, LIMITS, MAIL_TEMPLATES, type MailText } from "@/src/domain/mail-texts";
import { hotelLocales, LOCALE_NAMES, type Locale } from "@/src/i18n/dict";
import { render } from "@/src/email/templates";
import { env } from "@/src/env";
import type { Booking, Hotel } from "@/src/db/schema";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

async function save(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "mailtexts");
  const template = s(f, "template");
  if (!isMailTemplate(template)) redirect(`/admin/${c.hotel.id}/mail-texte`);
  const per: Record<string, MailText> = {};
  for (const l of hotelLocales(c.hotel)) per[l] = { subject: s(f, `subject_${l}`), intro: s(f, `intro_${l}`), outro: s(f, `outro_${l}`) };
  await saveMailTexts(c.hotel, template, per, c.actor);
  redirect(`/admin/${c.hotel.id}/mail-texte?t=${template}&saved=1`);
}

/** Vorschau mit Beispieldaten; schlägt sie fehl, zeigen wir nur den Hinweis */
function preview(hotel: Hotel, template: string, lang: Locale): string {
  try {
    const booking = {
      id: "x", reference: "BK-DEMO", publicToken: "demo", checkin: "2027-02-12", checkout: "2027-02-14", adults: 2, children: 0, totalRappen: 48000, depositRappen: 48000, balanceRappen: 0,
      status: "confirmed", source: "direct", language: lang, hotelId: hotel.id, balanceDueOn: null,
    } as unknown as Booking;
    const r = render(template, lang, { hotel, booking, guestName: "Anna Muster", data: { number: "2027-0001", kind: "invoice", totalRappen: 48000, invoiceId: "x", amountRappen: 12000 }, baseUrl: env().APP_BASE_URL });
    return `${r.subject}\n\n${r.text}`;
  } catch {
    return "(Vorschau nicht verfügbar)";
  }
}

export default async function MailTexte({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "mailtexts");
  const template = isMailTemplate(sp.t ?? "") ? sp.t! : MAIL_TEMPLATES[0].key;
  const langs = hotelLocales(hotel);
  const mine = hotel.content.mailTexts?.[template] ?? {};
  return (
    <div className="stack">
      <h1>Mail-Texte</h1>
      <p className="muted small">Eigene Sätze in den Mails an Ihre Gäste. Beträge, Daten, Links und Bedingungen bleiben unverändert, Ihre Texte kommen dazu. Platzhalter: {"{name}"}, {"{hotel}"}, {"{reference}"}. Leer lassen = Standardtext.</p>
      <nav className="seg" aria-label="Mail">
        {MAIL_TEMPLATES.map((t) => <a key={t.key} href={`?t=${t.key}`} aria-current={t.key === template ? "true" : undefined}>{t.label}</a>)}
      </nav>
      {sp.saved ? <p className="notice">Gespeichert.</p> : null}
      <form action={save} className="stack">
        <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="template" value={template} />
        {langs.map((l) => (
          <section key={l} className="card stack">
            <h2 style={{ margin: 0 }}>{LOCALE_NAMES[l] ?? l}</h2>
            <div><label>Betreff (ersetzt den Standard)</label><input name={`subject_${l}`} maxLength={LIMITS.subject} defaultValue={mine[l]?.subject ?? ""} /></div>
            <div><label>Einleitung (nach der Anrede)</label><textarea name={`intro_${l}`} rows={3} maxLength={LIMITS.intro} defaultValue={mine[l]?.intro ?? ""} /></div>
            <div><label>Schluss (vor der Grussformel)</label><textarea name={`outro_${l}`} rows={3} maxLength={LIMITS.outro} defaultValue={mine[l]?.outro ?? ""} /></div>
            <details><summary className="small">Vorschau (gespeicherter Stand, Beispieldaten)</summary><pre className="small" style={{ whiteSpace: "pre-wrap" }}>{preview(hotel, template, l)}</pre></details>
          </section>
        ))}
        <div><button className="btn">Speichern</button></div>
      </form>
    </div>
  );
}
