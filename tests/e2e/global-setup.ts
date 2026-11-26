/**
 * Vorwärmen: Der Dev-Server übersetzt jede Seite beim ersten Aufruf. Das dauert und liess erste Tests in die Zeitgrenze laufen.
 * Hier werden die Seiten ohne Anmeldung einmal aufgerufen; Fehler und Weiterleitungen sind egal.
 */
const ROUTES = ["/", "/admin/login", "/registrieren", "/api/health"];

export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  await Promise.all(ROUTES.map((r) => fetch(base + r, { redirect: "manual", signal: AbortSignal.timeout(100_000) }).catch(() => null)));
}
