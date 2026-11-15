import { unsubscribe, unsubscribeToken } from "@/src/services/newsletter";
import { normEmail } from "@/src/domain/newsletter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsletter abbestellen", robots: { index: false } };

/** Abmelde-Seite (SPEC 19.12): Der Link zeigt nur den Knopf, erst der Klick (POST) meldet ab – Mail-Scanner lösen nichts aus. */
export default async function Abmelden({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const h = sp.h ?? "", e = normEmail(sp.e ?? ""), t = sp.t ?? "";
  const valid = /^[0-9a-f-]{36}$/.test(h) && e && t && Buffer.from(t).equals(Buffer.from(unsubscribeToken(h, e)));
  async function confirm(f: FormData) {
    "use server";
    await unsubscribe(String(f.get("h")), String(f.get("e")), String(f.get("t")));
    const { redirect } = await import("next/navigation");
    redirect(`/abmelden?done=1`);
  }
  if (sp.done) return <main style={{ maxWidth: 480, margin: "64px auto", padding: 16 }}><h1>Abgemeldet</h1><p>Sie erhalten keine Newsletter mehr. / You will no longer receive newsletters.</p></main>;
  if (!valid) return <main style={{ maxWidth: 480, margin: "64px auto", padding: 16 }}><h1>Link ungültig</h1><p>Dieser Abmelde-Link ist nicht gültig. / This unsubscribe link is not valid.</p></main>;
  return (
    <main style={{ maxWidth: 480, margin: "64px auto", padding: 16 }}>
      <h1>Newsletter abbestellen</h1>
      <p>{e}</p>
      <form action={confirm}><input type="hidden" name="h" value={h} /><input type="hidden" name="e" value={e} /><input type="hidden" name="t" value={t} /><button className="btn">Abmelden / Unsubscribe</button></form>
    </main>
  );
}
