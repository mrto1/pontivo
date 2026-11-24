import { redirect } from "next/navigation";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { saveMailTexts } from "@/src/services/mail-texts";
import { cleanMailText, isMailTemplate, LIMITS, MAIL_TEMPLATES, type MailText } from "@/src/domain/mail-texts";
import { hotelLocales, LOCALE_NAMES, type Locale } from "@/src/i18n/dict";
import { defaultMailText, render } from "@/src/email/templates";
import { env } from "@/src/env";
import type { Booking, Hotel } from "@/src/db/schema";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

async function save(f: FormData) {
  "use server";
  const c = await requireHotelModule("mailtexts", s(f, "hotelId"), "manager");
  const template = s(f, "template");
  if (!isMailTemplate(template)) redirect(`/admin/${c.hotel.id}/mail-texte`);
  const per: Record<string, MailText> = {};
  for (const l of hotelLocales(c.hotel)) {
    const given = cleanMailText({ subject: s(f, `subject_${l}`), intro: s(f, `intro_${l}`), outro: s(f, `outro_${l}`) });
    // Felder, die noch genau dem Standardtext entsprechen, werden nicht gespeichert: sie bleiben Standard und folgen künftigen Verbesserungen
    const std = cleanMailText(defaultMailText(c.hotel, template, l, env().APP_BASE_URL));
    per[l] = { subject: given.subject === std.subject ? "" : given.subject, intro: given.intro === std.intro ? "" : given.intro, outro: given.outro };
  }
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
  const { hotel } = await requireHotelModule("mailtexts", hotelId, "manager");
  const template = isMailTemplate(sp.t ?? "") ? sp.t! : MAIL_TEMPLATES[0].key;
  const langs = hotelLocales(hotel);
  const mine = hotel.content.mailTexts?.[template] ?? {};
  const std = Object.fromEntries(langs.map((l) => [l, defaultMailText(hotel, template, l, env().APP_BASE_URL)]));
  return (
    <div className="stack">
      <h1>Gäste-Mails<InfoTip>Eigene Sätze in den Mails an Ihre Gäste. Beträge, Daten, Links und Bedingungen bleiben unverändert, Ihre Texte kommen dazu. Die Felder zeigen den Standardtext. Ändern Sie ihn nach Wunsch; Felder, die Sie nicht ändern, bleiben Standard. Ein leeres Feld stellt den Standardtext wieder her. Platzhalter: {"{name}"}, {"{hotel}"}, {"{reference}"}, {"{betrag}"} (offener Betrag), {"{datum}"} (Zahlungsfrist), {"{nummer}"} (Rechnungsnummer).</InfoTip></h1>
      <nav className="seg" aria-label="Mail">
        {MAIL_TEMPLATES.map((t) => <a key={t.key} href={`?t=${t.key}`} aria-current={t.key === template ? "true" : undefined}>{t.label}</a>)}
      </nav>
      {sp.saved ? <p className="notice">Gespeichert.</p> : null}
      <form action={save} className="stack">
        <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="template" value={template} />
        {langs.map((l) => (
          <section key={l} className="card stack">
            <h2 className="m0">{LOCALE_NAMES[l] ?? l}</h2>
            <div><label htmlFor={`f1168m1-${l}`}>Betreff</label><input id={`f1168m1-${l}`} name={`subject_${l}`} maxLength={LIMITS.subject} defaultValue={mine[l]?.subject ?? std[l].subject} /></div>
            <div><label htmlFor={`f1168m2-${l}`}>Einleitung (nach der Anrede)</label><textarea id={`f1168m2-${l}`} name={`intro_${l}`} rows={3} maxLength={LIMITS.intro} defaultValue={mine[l]?.intro ?? std[l].intro} /></div>
            <div><label htmlFor={`f1168m3-${l}`}>Zusätzlicher Schluss (vor der Grussformel, leer = keiner)</label><textarea id={`f1168m3-${l}`} name={`outro_${l}`} rows={3} maxLength={LIMITS.outro} defaultValue={mine[l]?.outro ?? ""} /></div>
            <details><summary className="small">Vorschau (gespeicherter Stand, Beispieldaten)</summary><pre className="small" style={{ whiteSpace: "pre-wrap" }}>{preview(hotel, template, l)}</pre></details>
          </section>
        ))}
        <div><button className="btn">Speichern</button></div>
      </form>
    </div>
  );
}
