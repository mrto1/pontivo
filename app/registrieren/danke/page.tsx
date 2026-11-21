import { PlatformFrame } from "@/components/marketing/Chrome";

export const dynamic = "force-dynamic";

export default async function Thanks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <PlatformFrame narrow hideSignup>
    <main style={{ padding: "24px 0 56px" }}>
      <h1>Fast geschafft</h1>
      <p>Wir haben Ihnen einen Login-Link geschickt. Öffnen Sie die E-Mail und klicken Sie auf den Link – danach startet der Einrichtungs-Assistent.</p>
      <p className="muted small">Der Link ist 15 Minuten gültig. Keine E-Mail erhalten? Spam-Ordner prüfen oder unter <a href="/admin/login">Anmelden</a> einen neuen Link anfordern.</p>
      {sp.dev ? <p className="notice warn small">Entwicklung (kein E-Mail-Versand konfiguriert): <a href={sp.dev}>Hier anmelden</a></p> : null}
    </main>
    </PlatformFrame>
  );
}
