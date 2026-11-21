import { requirePlatformAdmin } from "@/src/auth/guard";
import { platformOverview } from "@/src/services/platform-admin";
import { healthByHotel } from "@/src/services/health";
import { HEALTH_LABEL } from "@/src/domain/health";
import { listPlatformInvoices } from "@/src/services/billing";
import { cockpit } from "@/src/services/sales";
import { getPlatformVat } from "@/src/services/platform-settings";
import { schoolHolidayStats } from "@/src/services/holidays";
import { todayIn } from "@/src/domain/dates";
import { PageHead } from "./Flash";

export const dynamic = "force-dynamic";

const AREAS: { href: string; title: string; text: string }[] = [
  { href: "/plattform/betriebe", title: "Betriebe", text: "Status, Team, Ampel, pausieren und löschen." },
  { href: "/plattform/benutzer", title: "Benutzer", text: "Konten, Login-Link, Sicherheit zurücksetzen." },
  { href: "/plattform/vertrieb", title: "Vertrieb", text: "Leads, Status, nächste Schritte, persönliche Mails." },
  { href: "/plattform/rechnungen", title: "Rechnungen", text: "Monatsrechnungen an die Betriebe, Belastungen." },
  { href: "/plattform/mwst", title: "MWST", text: "MWST-Pflicht der Plattform, Satz und Nummer." },
  { href: "/plattform/zahlungsverbindung", title: "Zahlungsverbindung", text: "IBAN und Zahlungsfrist für QR-Rechnungen." },
  { href: "/plattform/admins", title: "Plattform-Admins", text: "Wer diese Verwaltung sehen darf." },
  { href: "/plattform/website", title: "Website-Texte", text: "Texte der Pontivo-Startseite." },
  { href: "/plattform/schulferien", title: "Schulferien", text: "Kantonale Ferien für die Preisempfehlung einspielen." },
];

export default async function Uebersicht() {
  await requirePlatformAdmin();
  const today = todayIn("Europe/Zurich");
  const [{ hotels, users }, health, invoices, sales, vat, school] = await Promise.all([platformOverview(), healthByHotel(), listPlatformInvoices(), cockpit(), getPlatformVat(), schoolHolidayStats(today)]);
  const live = hotels.filter((h) => h.status === "live").length;
  const attention = hotels.flatMap((h) => { const x = health.get(h.id); return x && x.level !== "green" ? [{ h, x }] : []; });
  const failed = invoices.filter(({ c }) => c.status === "failed");
  const dunned = invoices.filter(({ c }) => c.status === "invoiced" && c.dunningLevel >= 2);
  const todo: { key: string; level: "red" | "yellow"; text: React.ReactNode }[] = [
    ...failed.map(({ c, hotelName }) => ({ key: `inv${c.id}`, level: "red" as const, text: <><a href="/plattform/rechnungen">Belastung fehlgeschlagen</a>: {hotelName}, {c.month} ({c.attempts}×)</> })),
    ...dunned.map(({ c, hotelName }) => ({ key: `dun${c.id}`, level: (c.dunningLevel >= 3 ? "red" : "yellow") as "red" | "yellow", text: <><a href="/plattform/rechnungen">QR-Rechnung gemahnt</a>: {hotelName}, {c.invoiceNo} ({c.dunningLevel === 3 ? "2. Mahnung" : "1. Mahnung"})</> })),
    ...attention.map(({ h, x }) => ({ key: `h${h.id}`, level: x.level as "red" | "yellow", text: <><a href="/plattform/betriebe">{h.name}</a>: {HEALTH_LABEL[x.level]}{x.reasons[0] ? ` (${x.reasons[0].text})` : ""}</> })),
    ...(sales.due ? [{ key: "leads", level: "yellow" as const, text: <><a href="/plattform/vertrieb">{sales.due} Lead{sales.due === 1 ? "" : "s"}</a>: nächster Schritt fällig</> }] : []),
    ...(school.length === 0 ? [{ key: "school", level: "yellow" as const, text: <><a href="/plattform/schulferien">Schulferien</a>: noch keine eingespielt (Preisempfehlung ohne Ferienvorschläge)</> }] : []),
  ];
  // Rot zuerst, höchstens 8 Zeilen (die ganze Liste steht unter «Betriebe»)
  const shown = [...todo].sort((a, b) => Number(b.level === "red") - Number(a.level === "red")).slice(0, 8);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title="Plattform-Verwaltung">Nur für Pontivo-Admins. Hier siehst du den Stand der Plattform und was Aufmerksamkeit braucht. Die Bereiche findest du oben im Menü.</PageHead>

      <section className="tiles">
        <a className="card tile" href="/plattform/betriebe" style={{ textDecoration: "none", color: "inherit" }}><span className="muted small">Betriebe online</span><strong>{live} <span className="muted small" style={{ fontWeight: 400 }}>von {hotels.length}</span></strong></a>
        <a className="card tile" href="/plattform/benutzer" style={{ textDecoration: "none", color: "inherit" }}><span className="muted small">Benutzer</span><strong>{users.length}</strong></a>
        <a className="card tile" href="/plattform/vertrieb" style={{ textDecoration: "none", color: "inherit" }}><span className="muted small">Offene Leads</span><strong>{sales.funnel.open}</strong></a>
        <a className="card tile" href="/plattform/rechnungen" style={{ textDecoration: "none", color: "inherit" }}><span className="muted small">Fehlgeschlagene Belastungen</span><strong>{failed.length}</strong></a>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Braucht Aufmerksamkeit</h2>
        {todo.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Alles in Ordnung.</p> : (
          <>
            <ul className="ampel-reasons small" style={{ margin: 0 }}>{shown.map((t) => <li key={t.key} className={`ampel-${t.level}`}>{t.text}</li>)}</ul>
            {todo.length > shown.length ? <p className="small" style={{ margin: 0 }}>… und {todo.length - shown.length} weitere. <a href="/plattform/betriebe">Alle Betriebe ansehen</a></p> : null}
          </>
        )}
        <p className="muted small" style={{ margin: 0 }}>MWST: {vat.liableFrom ? `pflichtig ab ${vat.liableFrom}` : "nicht pflichtig"} · Schulferien eingespielt: {school.length ? school.map((x) => `${x.canton} ${x.n}`).join(", ") : "keine"}</p>
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Bereiche</h2>
        <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
          {AREAS.map((a) => (
            <a key={a.href} className="card tile" href={a.href} style={{ textDecoration: "none", color: "inherit" }}>
              <strong style={{ fontSize: "1.05rem" }}>{a.title}</strong><span className="muted small">{a.text}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
