import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LegalDoc } from "@/src/legal/texts";
import { getHotelByHost } from "@/src/services/hotels";
import { PlatformFrame } from "./Chrome";

/** Rechtliche Seiten der Plattform (nicht auf Hotel-Domains) */
export async function PlatformLegalPage({ doc }: { doc: LegalDoc }) {
  if (await getHotelByHost((await headers()).get("host"))) redirect("/");
  return (
    <PlatformFrame narrow>
    <main className="legal u-p-8px-0-40px">
      {doc.draftNote ? <p className="notice warn small">{doc.draftNote}</p> : null}
      <h1>{doc.title}</h1>
      <p>{doc.intro}</p>
      {doc.sections.map((x) => (
        <section key={x.h}><h2 className="u-fs-1-2rem">{x.h}</h2>{x.p.map((t, i) => <p key={i}>{t}</p>)}</section>
      ))}
    </main>
    </PlatformFrame>
  );
}
