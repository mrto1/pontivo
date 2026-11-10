import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LegalDoc } from "@/src/legal/texts";
import { getHotelByHost } from "@/src/services/hotels";
import { env } from "@/src/env";
import { pageHref } from "./PontivoHome";

/** Rechtliche Seiten der Plattform (nicht auf Hotel-Domains) */
export async function PlatformLegalPage({ doc }: { doc: LegalDoc }) {
  if (await getHotelByHost((await headers()).get("host"))) redirect("/");
  const st = process.env.STATIC_SITE === "1";
  return (
    <main className="wrap legal" style={{ maxWidth: 760, padding: "40px 16px 64px" }}>
      <p><a href={pageHref("/", st)} className="brand">{env().PLATFORM_NAME}</a></p>
      {doc.draftNote ? <p className="notice warn small">{doc.draftNote}</p> : null}
      <h1>{doc.title}</h1>
      <p>{doc.intro}</p>
      {doc.sections.map((x) => (
        <section key={x.h}><h2 style={{ fontSize: "1.2rem" }}>{x.h}</h2>{x.p.map((t, i) => <p key={i}>{t}</p>)}</section>
      ))}
      <p className="small muted" style={{ marginTop: 40 }}>
        <a href={pageHref("/impressum", st)}>Impressum</a> · <a href={pageHref("/datenschutz", st)}>Datenschutz</a> · <a href={pageHref("/gastgeber-bedingungen", st)}>Bedingungen für Gastgeber</a>
      </p>
    </main>
  );
}
