import type { Hotel } from "@/src/db/schema";
import { t, type Locale } from "@/src/i18n/dict";
import { platformInfo, privacy, terms } from "@/src/legal/texts";
import { env } from "@/src/env";
import { Shell } from "./Shell";

export function LegalPage({ hotel, locale, base, kind }: { hotel: Hotel; locale: Locale; base: string; kind: "agb" | "datenschutz" }) {
  const doc = kind === "agb" ? terms(hotel, locale) : privacy(hotel, locale);
  const showDraft = env().NODE_ENV !== "production" || platformInfo().missing;
  return (
    <Shell hotel={hotel} locale={locale} base={base} path={`/${kind}`}>
      <article style={{ padding: "32px 0", maxWidth: 760 }}>
        <h1>{doc.title}</h1>
        {t(locale).legalInEnglish ? <p className="notice small">{t(locale).legalInEnglish}</p> : null}
        {showDraft ? <p className="notice warn small">{doc.draftNote}</p> : null}
        <p>{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.h} style={{ marginTop: 24 }}>
            <h3>{s.h}</h3>
            {s.p.map((t, i) => <p key={i}>{t}</p>)}
          </section>
        ))}
      </article>
    </Shell>
  );
}
