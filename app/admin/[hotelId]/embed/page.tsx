import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { publicBase, setLogo, updateBrand } from "@/src/services/brand";
import { deleteImage } from "@/src/lib/storage";
import { env } from "@/src/env";
import { CopyBox } from "@/components/admin/CopyBox";
import { WidgetPreview } from "@/components/admin/WidgetPreview";

export const dynamic = "force-dynamic";

async function saveBrand(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(String(f.get("hotelId")), "manager");
  let msg = "Gespeichert";
  try {
    await updateBrand(hotel, {
      mode: f.get("mode") === "booking_only" ? "booking_only" : "website",
      color: String(f.get("useColor")) === "on" ? String(f.get("color")) : null,
      websiteUrl: String(f.get("websiteUrl") ?? "").trim() || null,
    }, actor);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    msg = `Nicht gespeichert: ${e.issues.map((i) => i.message).join(", ")}`;
  }
  redirect(`/admin/${hotel.id}/embed?msg=${encodeURIComponent(msg)}`);
}

async function removeLogo(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(String(f.get("hotelId")), "manager");
  const old = await setLogo(hotel.id, null, actor);
  if (old) await deleteImage(old);
  redirect(`/admin/${hotel.id}/embed?msg=${encodeURIComponent("Logo entfernt")}`);
}

export default async function Embed({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const brand = hotel.content.brand ?? {};
  const base = publicBase(hotel);
  const lang = hotel.defaultLanguage === "en" ? "en" : "de";
  const scriptSrc = `${env().APP_BASE_URL}/widget/${hotel.slug}.js`;
  const link = `${base}/${lang}`;
  const button = `<div data-pontivo="${hotel.slug}" data-mode="button"></div>\n<script src="${scriptSrc}" async></script>`;
  const search = `<div data-pontivo="${hotel.slug}" data-mode="search"></div>\n<script src="${scriptSrc}" async></script>`;
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <h1>Buchung einbinden</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") || sp.msg.startsWith("Logo:") ? "warn" : ""}`}>{sp.msg}</p> : null}

      <section className="card stack">
        <h2>Wie nutzt das Hotel {env().PLATFORM_NAME}?</h2>
        <form action={saveBrand} className="stack">
          {hidden}
          <label className="check"><input type="radio" name="mode" value="booking_only" defaultChecked={brand.mode === "booking_only"} disabled={!canEdit} /><span><strong>Wir behalten unsere Website</strong> – {env().PLATFORM_NAME} übernimmt nur die Buchung. Der Gast kommt über einen Knopf auf unserer Website zur Buchungsseite.</span></label>
          <label className="check"><input type="radio" name="mode" value="website" defaultChecked={brand.mode !== "booking_only"} disabled={!canEdit} /><span><strong>{env().PLATFORM_NAME} ist unsere Website</strong> – Startseite, Zimmer und Buchung unter unserer Domain.</span></label>
          <div className="form-grid">
            <div><label>Adresse der eigenen Website</label><input name="websiteUrl" type="url" placeholder="https://www.hotel.ch" defaultValue={brand.websiteUrl ?? ""} disabled={!canEdit} /></div>
            <div>
              <label>Hauptfarbe (Knöpfe, Links)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input name="color" type="color" defaultValue={brand.color ?? "#2f5d50"} style={{ width: 64, height: 42, padding: 2 }} disabled={!canEdit} />
                <label className="check" style={{ margin: 0 }}><input type="checkbox" name="useColor" defaultChecked={!!brand.color} disabled={!canEdit} />verwenden</label>
              </div>
            </div>
          </div>
          {canEdit ? <button className="btn">Speichern</button> : null}
        </form>
      </section>

      <section className="card stack">
        <h2>Logo</h2>
        {brand.logoUrl ? <img src={brand.logoUrl} alt="Logo" style={{ maxHeight: 60, maxWidth: 240, objectFit: "contain", alignSelf: "flex-start" }} /> : <p className="muted small">Noch kein Logo – oben auf der Buchungsseite steht dann der Hotelname.</p>}
        {canEdit ? (
          <div className="inline-form">
            <form action={`/api/admin/hotels/${hotel.id}/photos`} method="post" encType="multipart/form-data" className="inline-form">
              <input type="hidden" name="target" value="logo" />
              <div><label>Logo hochladen (PNG mit transparentem Hintergrund, JPG oder WebP)</label><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required /></div>
              <button className="btn small">Hochladen</button>
            </form>
            {brand.logoUrl ? <form action={removeLogo}>{hidden}<button className="btn secondary small">Logo entfernen</button></form> : null}
          </div>
        ) : null}
        <p className="small"><a href={link} target="_blank">Buchungsseite ansehen</a></p>
      </section>

      <section className="card stack">
        <h2>Auf der eigenen Website einbinden</h2>
        <p className="small">Drei Möglichkeiten – von ganz einfach bis eingebaut. Alle führen zur Buchungsseite im Erscheinungsbild des Hotels.</p>

        <h3>Einfachste Lösung: bestehenden «Buchen»-Link ersetzen</h3>
        <p className="small muted">Funktioniert mit jedem Baukasten (Wix, Jimdo, WordPress, Webflow …): beim Knopf oder Menüpunkt «Buchen» diese Adresse eintragen.</p>
        <CopyBox text={link} label="Link zur Buchungsseite" />

        <h3>Knopf «Jetzt buchen»</h3>
        <p className="small muted">Diesen Code an der Stelle einfügen, wo der Knopf erscheinen soll (in WordPress z. B. mit einem «HTML»-Block). Eigener Text: <code>data-label=&quot;Zimmer buchen&quot;</code>. Andere Sprache: <code>data-lang=&quot;en&quot;</code> (oder fr, it, nl, wenn unter Website → Sprachen gewählt).</p>
        <CopyBox text={button} label="Code für den Knopf" />
        <div className="card"><WidgetPreview src={scriptSrc} slug={hotel.slug} mode="button" /></div>

        <h3>Suchleiste mit Daten und Personen</h3>
        <p className="small muted">Der Gast wählt die Daten direkt auf Ihrer Website und sieht danach sofort die freien Zimmer.</p>
        <CopyBox text={search} label="Code für die Suchleiste" />
        <div className="card" style={{ background: "var(--accent-soft)" }}><WidgetPreview src={scriptSrc} slug={hotel.slug} mode="search" /></div>
        {hotel.status !== "live" ? <p className="notice warn small">Das Hotel ist noch nicht live – Gäste sehen auf der Buchungsseite einen Hinweis statt Angeboten.</p> : null}
      </section>
    </div>
  );
}
