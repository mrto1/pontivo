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
      <p className="muted">Angemeldet als {user.email}. Der Login per E-Mail-Link bleibt immer möglich.</p>
      <AccountSecurity
        passkeys={pks.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null }))}
        totpOn={totp}
        passkeyOnly={user.emailLoginDisabled}
        codesLeft={left}
      />
    </main>
  );
}
