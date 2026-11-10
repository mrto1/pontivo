import { hostTerms, HOST_TERMS_VERSION } from "@/src/legal/host-terms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bedingungen für Gastgeber" };

export default function HostTerms() {
  const d = hostTerms();
  return (
    <main className="wrap legal" style={{ maxWidth: 760, padding: "48px 16px" }}>
      <p className="notice warn small">{d.draftNote}</p>
      <h1>{d.title}</h1>
      <p>{d.intro}</p>
      {d.sections.map((x) => (
        <section key={x.h}><h2 style={{ fontSize: "1.2rem" }}>{x.h}</h2>{x.p.map((p, i) => <p key={i}>{p}</p>)}</section>
      ))}
      <p className="small muted">Version {HOST_TERMS_VERSION}</p>
    </main>
  );
}
