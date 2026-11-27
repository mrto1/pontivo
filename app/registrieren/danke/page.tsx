import { PlatformFrame } from "@/components/marketing/Chrome";

export const dynamic = "force-dynamic";

export default async function Thanks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <PlatformFrame narrow hideSignup>
    <main className="u-p-24px-0-56px">
      <h1>Fast geschafft</h1>
      <p>Wir haben Ihnen eine E-Mail geschickt. Bestätigen Sie darin Ihre Adresse und melden Sie sich danach mit E-Mail und Passwort an – dann startet der Einrichtungs-Assistent.</p>
      <p className="muted small">Der Link ist 3 Tage gültig. Keine E-Mail erhalten? Spam-Ordner prüfen oder unter <a href="/admin/login">Anmelden</a> über «Passwort vergessen?» einen Link anfordern.</p>
      {sp.dev ? <p className="notice warn small">Entwicklung (kein E-Mail-Versand konfiguriert): <a href={sp.dev}>Link öffnen</a></p> : null}
    </main>
    </PlatformFrame>
  );
}
