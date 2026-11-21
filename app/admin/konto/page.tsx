import { requireUser } from "@/src/auth/guard";
import { hasTotp, listPasskeys, recoveryCodesLeft } from "@/src/services/mfa";
import { AccountSecurity } from "@/components/admin/AccountSecurity";

export const dynamic = "force-dynamic";

export default async function Konto() {
  const user = await requireUser();
  const [pks, totp, left] = await Promise.all([listPasskeys(user.id), hasTotp(user.id), recoveryCodesLeft(user.id)]);
  return (
    <main className="wrap" style={{ maxWidth: 640, padding: "40px 16px" }}>
      <p><a href="/admin">← Übersicht</a></p>
      <h1>Sicherheit</h1>
      <p className="muted">Angemeldet als {user.email}. Mit Passwort oder Passkey; der Login-Link per E-Mail bleibt für «Passwort vergessen» möglich.</p>
      <AccountSecurity
        passkeys={pks.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null }))}
        totpOn={totp}
        passkeyOnly={user.emailLoginDisabled}
        passwordSet={!!user.passwordHash}
        codesLeft={left}
      />
    </main>
  );
}
