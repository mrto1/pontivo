import { requireHotel } from "@/src/auth/guard";
import { roleLabel } from "@/src/domain/roles";
import { hasTotp, listPasskeys, recoveryCodesLeft } from "@/src/services/mfa";
import { AccountSecurity } from "@/components/admin/AccountSecurity";
import { ChangeEmail } from "@/components/admin/ChangeEmail";
import { InstallApp } from "@/components/admin/InstallApp";
import { PushToggle } from "@/components/admin/PushToggle";
import { NativePush } from "@/components/admin/NativePush";
import { visibleNav } from "@/src/admin/visible-nav";
import { hiddenNavKeys } from "@/src/domain/modules";
import { PUSH_KINDS, PUSH_KIND_LABEL, pushVisible } from "@/src/domain/push-kinds";
import { getPushPrefs, savePushPrefs } from "@/src/push/service";
import { moduleRows } from "@/src/services/modules";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function savePrefs(f: FormData) {
  "use server";
  const hotelId = String(f.get("hotelId") ?? "");
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "konto");
  const navs = visibleNav(hotel, role, hiddenNavKeys(await moduleRows(hotel.id))).navs;
  // Nur Arten, die diese Person sehen darf; ein Kästchen ohne Haken heisst «aus»
  const prefs = Object.fromEntries(PUSH_KINDS.filter((k) => pushVisible(role, k, navs)).map((k) => [k, f.get(`k_${k}`) === "on"]));
  await savePushPrefs(hotel.id, user.id, prefs);
  revalidatePath(`/admin/${hotel.id}/konto`);
}

/** Mein Konto (Teil des Admin-Bereichs): eigenes Konto, Webseite-Vorschau, App und Mitteilungen, Sicherheit (SPEC 18.10) */
export default async function MyPontivo({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "konto");
  const [pks, totp, left] = await Promise.all([listPasskeys(user.id), hasTotp(user.id), recoveryCodesLeft(user.id)]);
  const navs = visibleNav(hotel, role, hiddenNavKeys(await moduleRows(hotel.id))).navs;
  const kinds = PUSH_KINDS.filter((k) => pushVisible(role, k, navs));
  const prefs = await getPushPrefs(hotel.id, user.id);
  const preview = hotel.primaryDomain ? `//${hotel.primaryDomain}` : `/h/${hotel.slug}/de`;
  return (
    <div className="stack" style={{ gap: 28, maxWidth: 760 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>Mein Konto</h1>
        <div className="mp-top">
          <strong>{user.email}</strong>
          <span className="muted">{user.isPlatformAdmin ? "Plattformbetreiber" : roleLabel(role)} bei {hotel.name}</span>
        </div>
        <p className="mt8"><ChangeEmail current={user.email} needsCode={totp} /></p>
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
        <NativePush hotelId={hotel.id} />
        <p className="muted small">Die Einstellung oben gilt nur für dieses Gerät und diesen Betrieb; auf jedem Gerät einzeln einschalten. Worüber Sie Mitteilungen bekommen, gilt für alle Ihre Geräte:</p>
        <form action={savePrefs} className="stack" data-testid="push-prefs">
          <input type="hidden" name="hotelId" value={hotel.id} />
          {kinds.map((k) => (
            <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="checkbox" name={`k_${k}`} defaultChecked={prefs[k] !== false} style={{ marginTop: 4 }} />
              <span><strong>{PUSH_KIND_LABEL[k].title}</strong><br /><span className="muted small">{PUSH_KIND_LABEL[k].hint}</span></span>
            </label>
          ))}
          <div><button className="btn secondary small">Speichern</button></div>
        </form>
      </section>

      <section className="card mp-section" id="sicherheit">
        <h2>Sicherheit</h2>
        <p className="muted">Anmeldung mit Passwort oder Passkey sind gleichwertig; der Login-Link per E-Mail bleibt für «Passwort vergessen». Die Authenticator-App (2FA) kommt freiwillig zusätzlich dazu.</p>
        <AccountSecurity
          passkeys={pks.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null }))}
          totpOn={totp}
          passkeyOnly={user.emailLoginDisabled}
        passwordSet={!!user.passwordHash}
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
