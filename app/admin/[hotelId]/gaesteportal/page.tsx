import { FormSwitch } from "@/components/admin/FormSwitch";
import { InfoTip } from "@/components/admin/InfoTip";
import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { moduleOn } from "@/src/services/modules";
import { addPortalTip, deletePortalTip, savePortalSettings } from "@/src/services/portal-settings";
import { STANDARD_WISHES, doorCodeEnabled, folioEnabled, requestsEnabled, selfCheckoutEnabled, wishOptions } from "@/src/domain/portal";
import { tr } from "@/src/domain/blocks";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";
const back = (id: string, msg: string): never => redirect(`/admin/${id}/gaesteportal?msg=${encodeURIComponent(msg)}`);

async function save(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await savePortalSettings(c.hotel, c.actor, {
    requests: f.get("requests") === "on", doorCode: f.get("doorCode") === "on", folio: f.get("folio") === "on", selfCheckout: f.get("selfCheckout") === "on",
    standardIds: f.getAll("wish").map(String), custom: String(f.get("custom") ?? ""),
  });
  back(c.hotel.id, "Gespeichert.");
}

async function addTip(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  try {
    await addPortalTip(c.hotel, c.actor, { title: { de: s(f, "titleDe"), en: s(f, "titleEn") }, text: { de: s(f, "textDe"), en: s(f, "textEn") } });
  } catch (e) {
    back(c.hotel.id, `Nicht gespeichert: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  back(c.hotel.id, "Tipp gespeichert.");
}

async function removeTip(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await deletePortalTip(c.hotel, c.actor, s(f, "id"));
  back(c.hotel.id, "Tipp gelöscht.");
}

export default async function PortalSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  const p = hotel.content.portal;
  const wishes = wishOptions(p);
  const standardOn = new Set(wishes.map((w) => w.id));
  const customText = wishes.filter((w) => /^c\d+$/.test(w.id)).map((w) => (w.label.en ? `${w.label.de} | ${w.label.en}` : w.label.de ?? "")).join("\n");
  const access = await moduleOn(hotel.id, "access");
  const tips = p?.tips ?? [];
  return (
    <div className="stack">
      <h1>Gästeportal<InfoTip>Die Buchungsseite, die der Gast über den Link in seiner Mail öffnet (kein Login). Hier legen Sie fest, was er dort sieht und tun kann. Die Seite sieht für alle Betriebe gleich aus, Sie ändern nur die Inhalte.</InfoTip></h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}

      <form action={save} className="card stack">
        <input type="hidden" name="hotelId" value={hotel.id} />
        <h2>Wünsche und Funktionen</h2>
        <div className="opt-list">
          <FormSwitch name="requests" defaultOn={requestsEnabled(p)} label="Gäste können Wünsche melden" hint={<>Antwort im <a href={`/admin/${hotel.id}/inbox?quelle=wuensche`}>Posteingang</a>, mit Mitteilung aufs Handy und per Mail an {hotel.contactEmail}.</>} />
        </div>
        <h3 style={{ margin: "8px 0 0" }}>Wunschliste</h3>
        <div className="opt-list">
          {STANDARD_WISHES.map((w) => <FormSwitch key={w.id} name="wish" value={w.id} defaultOn={standardOn.has(w.id)} label={w.label.de} />)}
        </div>
        <label htmlFor="custom">Eigene Wünsche (eine Zeile je Wunsch; Übersetzung optional mit «Deutsch | Englisch»)</label>
        <textarea id="custom" name="custom" rows={4} maxLength={1500} defaultValue={customText} placeholder={"Frühstück auf dem Zimmer | Breakfast in the room\nHund mitbringen"} />
        <p className="small muted">Frühstück und andere Bezahl-Extras bleiben bei «Upselling»: dort kann der Gast sie direkt online dazubuchen.</p>
        <h3 style={{ margin: "8px 0 0" }}>Während des Aufenthalts</h3>
        <div className="opt-list">
          <FormSwitch name="folio" defaultOn={folioEnabled(p)} label="Rechnung bis jetzt zeigen" hint="Posten aufs Zimmer (z. B. Restaurant) und offener Betrag." />
          <FormSwitch name="selfCheckout" defaultOn={selfCheckoutEnabled(p)} label="Selbst auschecken am Abreisetag" hint="Vermerk in der Tagesliste und im Posteingang; Zimmer, Schlüssel und offene Posten prüft die Rezeption." />
          <FormSwitch name="doorCode" defaultOn={doorCodeEnabled(p)} disabled={!access} label="Türcode zeigen ab Anreisetag" hint={access ? "Sobald der Online-Check-in ausgefüllt ist (falls aktiv)." : "Braucht die Funktion «Zutritt (Nuki)»."} />
        </div>
        <div><button className="btn">Speichern</button></div>
      </form>

      <section className="card stack">
        <h2>Tipps und Infos</h2>
        <p className="small muted">Einträge wie Wanderung, Restaurant, Bergbahn oder Hausregel. Der Gast sieht sie als Liste im Portal, der KI-Chat nutzt dieselben Texte. Der Freitext «Infos für den Aufenthalt» (im Einrichtungs-Assistenten) bleibt daneben bestehen.</p>
        {tips.length ? (
          <ul className="list">
            {tips.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span><strong>{tr(t.title, "de") || tr(t.title, "en")}</strong><br /><span className="small muted">{(tr(t.text, "de") || tr(t.text, "en")).slice(0, 160)}</span></span>
                <form action={removeTip}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={t.id} /><button className="btn secondary small">Löschen</button></form>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Noch keine Tipps.</p>}
        <form action={addTip} className="stack">
          <input type="hidden" name="hotelId" value={hotel.id} />
          <div><label htmlFor="tde">Titel (Deutsch)</label><input id="tde" name="titleDe" maxLength={120} required /></div>
          <div><label htmlFor="xde">Text (Deutsch)</label><textarea id="xde" name="textDe" rows={3} maxLength={1500} /></div>
          <div><label htmlFor="ten">Titel (Englisch, optional)</label><input id="ten" name="titleEn" maxLength={120} /></div>
          <div><label htmlFor="xen">Text (Englisch, optional)</label><textarea id="xen" name="textEn" rows={3} maxLength={1500} /></div>
          <div><button className="btn secondary">Tipp hinzufügen</button></div>
        </form>
      </section>
      <p className="small muted">Ansicht des Gastes: öffnen Sie einen Buchungslink aus einer Bestätigungsmail.</p>
    </div>
  );
}
