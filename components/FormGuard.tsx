import { GUARD_FIELD, HONEYPOT_FIELD, issueGuardToken } from "@/src/lib/form-guard";

/** Unsichtbare Schutzfelder (Honeypot und signierter Zeitstempel). In jedes öffentliche Formular einfügen; serverseitig mit checkGuardForm prüfen. */
export function FormGuard() {
  return (
    <>
      <input type="hidden" name={GUARD_FIELD} value={issueGuardToken()} />
      <div className="hp" aria-hidden="true"><label>Website<input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" /></label></div>
    </>
  );
}
