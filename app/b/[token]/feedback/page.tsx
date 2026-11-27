import { notFound, redirect } from "next/navigation";
import { getBookingByToken } from "@/src/services/bookings";
import { FeedbackError, submitFeedback } from "@/src/services/feedback";
import { moduleOn } from "@/src/services/modules";
import { isLocale, type Locale } from "@/src/i18n/dict";
import { F } from "@/src/i18n/feedback";
import { Shell } from "@/components/public/Shell";
import { limitByIpAndEmail } from "@/src/lib/public-form";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

async function send(f: FormData) {
  "use server";
  const token = String(f.get("token") ?? "");
  const lang = String(f.get("lang") ?? "de");
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  // Grenze je IP (Datenbank); die Buchung erlaubt ohnehin nur eine Rückmeldung
  if (!(await limitByIpAndEmail("feedback", ip, "", { ipLimit: 30, ipWindowMs: 3_600_000, emailLimit: 1, emailWindowMs: 1000 }))) redirect(`/b/${token}/feedback?lang=${lang}&r=invalid`);
  let result = "invalid";
  try {
    const r = await submitFeedback(token, Number(f.get("score")), String(f.get("comment") ?? ""));
    result = r.outcome;
  } catch (e) {
    if (!(e instanceof FeedbackError)) throw e;
    if (e.message === "not_found") notFound();
  }
  redirect(`/b/${token}/feedback?lang=${lang}&r=${result}`);
}

/** Bewertungsfrage nach dem Aufenthalt (SPEC 19.2): erreichbar nur über den persönlichen Buchungslink */
export default async function FeedbackPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const found = await getBookingByToken(token);
  if (!found || !(await moduleOn(found.hotel.id, "feedback"))) notFound();
  const { booking, hotel } = found;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : isLocale(booking.language) ? booking.language : "de";
  const f = F[locale];
  const base = hotel.primaryDomain ? "" : `/h/${hotel.slug}`;
  // Nur https-Links der Bewertungsseite weiterreichen, und nur den, der in den Einstellungen des Hauses steht
  const reviewUrl = hotel.content?.feedback?.reviewUrl ?? "";
  return (
    <Shell hotel={hotel} locale={locale} base={base}>
      <section className="pad32-560">
        <h1>{f.title}</h1>
        {sp.r === "public" && reviewUrl ? (
          <div className="stack"><p className="notice">{f.thanksPublic}</p><p><a className="btn" href={reviewUrl} target="_blank" rel="noopener noreferrer">{f.publicButton}</a></p></div>
        ) : sp.r === "internal" ? <p className="notice">{f.thanksInternal}</p>
        : sp.r === "already" ? <p className="notice">{f.already}</p>
        : (
          <form action={send} className="stack">
            {sp.r === "invalid" ? <p className="notice warn">{f.invalid}</p> : null}
            <p className="muted">{f.intro}</p>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="lang" value={locale} />
            <fieldset className="u-b-0 u-p-0">
              <legend>{f.scoreLabel}</legend>
              {[5, 4, 3, 2, 1].map((n) => (
                <label className="u-d-block u-p-6px-0" key={n}><input type="radio" name="score" value={n} required /> {n} · {f.scores[n - 1]}</label>
              ))}
            </fieldset>
            <label>{f.commentLabel}<textarea name="comment" rows={4} maxLength={2000} /></label>
            <div><button className="btn">{f.send}</button></div>
          </form>
        )}
      </section>
    </Shell>
  );
}
