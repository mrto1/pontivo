import { requireHotel } from "@/src/auth/guard";
import { ROLE_LABEL } from "@/src/domain/roles";
import { hasTotp, listPasskeys, recoveryCodesLeft } from "@/src/services/mfa";
import { AccountSecurity } from "@/components/admin/AccountSecurity";
import { ChangeEmail } from "@/components/admin/ChangeEmail";
import { InstallApp } from "@/components/admin/InstallApp";
import { PushToggle } from "@/components/admin/PushToggle";

export const dynamic = "force-dynamic";

/** myPontivo: eigenes Konto, Webseite-Vorschau, App und Mitteilungen, Sicherheit (SPEC 18.10) */
export default async function MyPontivo({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "mypontivo");
  const [pks, totp, left] = await Promise.all([listPasskeys(user.id), hasTotp(user.id), recoveryCodesLeft(user.id)]);
  const preview = hotel.primaryDomain ? `//${hotel.primaryDomain}` : `/h/${hotel.slug}/de`;
  return (
    <div className="stack" style={{ gap: 28, maxWidth: 760 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>myPontivo</h1>
        <div className="mp-top">
          <strong>{user.email}</strong>
          <span className="muted">{user.isPlatformAdmin ? "Plattformbetreiber" : ROLE_LABEL[role]} bei {hotel.name}</span>
        </div>
        <p style={{ marginTop: 8 }}><ChangeEmail current={user.email} needsCode={totp} /></p>
      </header>

      <section className="card mp-section" id="webseite">
        <h2>{hotel.name} Webseite</h2>
        <p className="muted">So sehen Gäste Ihre Seite und die Buchungsstrecke.</p>
        <p><a className="btn secondary small" href={preview} target="_blank" rel="noopener">Vorschau ansehen ↗</a></p>
      </section>

      <section className="card mp-section" id="app">
        <h2>Pontivo-App</h2>
        <InstallApp />
        <h3>Mitteilungen auf diesem Gerät</h3>
        <PushToggle hotelId={hotel.id} />
        <p className="muted small">Sie erhalten eine Mitteilung bei neuer Buchung, neuer Anfrage, Stornierung und Überbuchung. Die Einstellung gilt nur für dieses Gerät und diesen Betrieb; auf jedem Gerät schalten Sie sie separat ein. Ausschalten geht jederzeit hier, oder in den Einstellungen Ihres Browsers bzw. Handys.</p>
      </section>

      <section className="card mp-section" id="sicherheit">
        <h2>Sicherheit</h2>
        <p className="muted">Anmeldung per E-Mail-Link und per Passkey sind gleichwertig. Die Authenticator-App (2FA) kommt freiwillig zusätzlich dazu.</p>
        <AccountSecurity
          passkeys={pks.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null }))}
          totpOn={totp}
          passkeyOnly={user.emailLoginDisabled}
          codesLeft={left}
        />
      </section>

      <section className="card mp-section" id="weiteres">
        <h2>Weiteres</h2>
        <p><a href="/admin">Zur Übersicht aller Betriebe</a></p>
        <form action="/api/auth/logout" method="post"><button className="btn secondary small">Abmelden</button></form>
      </section>
    </div>
  );
}
