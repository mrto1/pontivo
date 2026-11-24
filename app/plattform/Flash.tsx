/** Rückmeldung nach einer Aktion (Adresse ?done=… bzw. ?error=…) */
export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  return (
    <>
      {sp.done ? <p className="notice">{sp.done}</p> : null}
      {sp.error === "confirm" ? <p className="notice warn">Bestätigung stimmt nicht, nichts gelöscht.</p> : null}
      {sp.error === "user" ? <p className="notice warn">Dieser Benutzer kann nicht gelöscht werden (Plattform-Admin oder man selbst).</p> : null}
      {sp.error && sp.error !== "confirm" && sp.error !== "user" ? <p className="notice warn">{sp.error}</p> : null}
    </>
  );
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="stack" style={{ gap: 6 }}>
      <h1 className="m0">{title}</h1>
      {children ? <p className="muted small m0">{children}</p> : null}
    </header>
  );
}
