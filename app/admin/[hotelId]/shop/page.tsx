import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { RowList } from "@/components/admin/RowList";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { GoodsError, adjustStock, deleteGood, listGoods, saveGood } from "@/src/services/goods";
import { VAT_LABEL, needsReorder } from "@/src/domain/goods";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (v: string) => (v === "" ? 0 : Number(v));
const hasMinibar = (type: string) => type !== "restaurant"; // reine Restaurants haben keine Minibar

async function guard(f: FormData) {
  const c = await requireHotelModule("shop", s(f, "hotelId"), "manager");
  return c;
}
const back = (hotelId: string, q: string) => redirect(`/admin/${hotelId}/shop${q}`);

async function saveAction(f: FormData) {
  "use server";
  const c = await guard(f);
  const id = s(f, "id");
  let msg = "Artikel gespeichert.";
  let ok = true;
  try {
    await saveGood(c.hotel.id, id || null, {
      name: s(f, "name"), category: s(f, "category"), priceRappen: Math.round(Number(s(f, "price").replace(",", ".") || 0) * 100), vat: s(f, "vat") as "standard",
      sellable: f.get("sellable") === "on", active: f.get("active") === "on", minibar: f.get("minibar") === "on", minibarPar: int(s(f, "minibarPar")),
      trackStock: f.get("trackStock") === "on", stock: int(s(f, "stock")), minStock: int(s(f, "minStock")),
    }, c.actor, hasMinibar(c.hotel.propertyType));
  } catch (e) {
    if (!(e instanceof GoodsError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
    ok = false;
  }
  back(c.hotel.id, `?${ok ? "" : `g=${id || "neu"}&`}msg=${encodeURIComponent(msg)}`);
}

async function receiveAction(f: FormData) {
  "use server";
  const c = await guard(f);
  const id = s(f, "id");
  let msg = "Bestand angepasst.";
  try {
    await adjustStock(c.hotel.id, id, Math.trunc(Number(s(f, "delta"))), c.actor, s(f, "reason") || "Wareneingang");
  } catch (e) {
    if (!(e instanceof GoodsError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  back(c.hotel.id, `?g=${id}&msg=${encodeURIComponent(msg)}`);
}

async function removeAction(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await deleteGood(c.hotel.id, s(f, "id"), c.actor); } catch (e) { if (!(e instanceof GoodsError)) throw e; }
  back(c.hotel.id, `?msg=${encodeURIComponent("Artikel gelöscht.")}`);
}

/** Shop & Lager (SPEC 19.51): Waren, Minibar-Zuweisung, optionaler Bestand, Nachbestellen */
export default async function ShopPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("shop", hotelId, "manager");
  const list = await listGoods(hotel.id);
  const mini = hasMinibar(hotel.propertyType);
  const base = `/admin/${hotel.id}/shop`;
  const creating = sp.g === "neu";
  const g = list.find((x) => x.id === sp.g);
  const drawerOpen = creating || !!g;
  const reorder = list.filter(needsReorder);
  return (
    <div className="stack">
      <h1>Shop &amp; Lager<InfoTip>Waren, die Sie verkaufen: Getränke, Snacks, Souvenirs{mini ? ", dazu die Minibar" : ""}. Auf Wunsch führen Sie den Bestand; fällt er unter den Mindestbestand, erscheint die Ware unter «Nachbestellen». In der Buchung buchen Sie Waren mit einem Klick aufs Zimmer.</InfoTip></h1>
      {sp.msg && !drawerOpen ? <Notice text={sp.msg} /> : null}
      {reorder.length ? (
        <div className="card stack" id="nachbestellen">
          <h3>Nachbestellen</h3>
          <ul className="plan-list">
            {reorder.map((x) => (
              <li key={x.id}><Link href={`${base}?g=${x.id}`} scroll={false} className="plan-row"><span><strong>{x.name}</strong><br /><span className="muted small">Bestand {x.stock} · Mindestbestand {x.minStock}</span></span><span className="rt-arrow" aria-hidden="true">›</span></Link></li>
            ))}
          </ul>
        </div>
      ) : null}
      {list.length === 0 ? <p className="muted">Noch keine Ware.</p> : null}
      <RowList rows={list.map((x) => ({ id: x.id, href: `${base}?g=${x.id}`, label: `${x.name} bearbeiten`, title: x.name,
        detail: `${x.category ? `${x.category} · ` : ""}${formatChf(x.priceRappen)}${x.minibar ? ` · Minibar ${x.minibarPar}` : ""}${x.trackStock ? ` · Bestand ${x.stock}` : ""}`,
        badges: [...(needsReorder(x) ? [{ text: "nachbestellen" }] : []), ...(x.active ? [] : [{ text: "inaktiv" }])] }))} />
      <div><Link className="btn secondary" href={`${base}?g=neu`} scroll={false}>+ Neue Ware</Link></div>

      {drawerOpen ? (
        <Drawer title={g ? g.name : "Neue Ware"} closeHref={base}>
              {sp.msg ? <Notice text={sp.msg} /> : null}
              <form action={saveAction} className="stack">
                <input type="hidden" name="hotelId" value={hotel.id} />{g ? <input type="hidden" name="id" value={g.id} /> : null}
                <div><label htmlFor="f01b21">Name</label><input id="f01b21" name="name" defaultValue={g?.name ?? ""} required maxLength={100} placeholder="z. B. Mineralwasser 5 dl" /></div>
                <div className="form-grid">
                  <div><label htmlFor="f01b22">Kategorie</label><input id="f01b22" name="category" defaultValue={g?.category ?? ""} maxLength={60} placeholder="z. B. Getränke" /></div>
                  <div><label htmlFor="f01b23">Preis CHF</label><input id="f01b23" name="price" inputMode="decimal" defaultValue={g ? g.priceRappen / 100 : 0} /></div>
                  <div><label htmlFor="f01b24">MWST</label><select id="f01b24" name="vat" defaultValue={g?.vat ?? "standard"}>{Object.entries(VAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>
                <label className="check"><input type="checkbox" name="sellable" defaultChecked={g?.sellable ?? true} />Verkäuflich (sonst reiner Vorrat)</label>
                <label className="check"><input type="checkbox" name="active" defaultChecked={g?.active ?? true} />Aktiv</label>
                {mini ? (
                  <div className="form-grid">
                    <label className="check"><input type="checkbox" name="minibar" defaultChecked={g?.minibar} />In der Minibar</label>
                    <div><label htmlFor="f01b25">Sollmenge pro Zimmer</label><input id="f01b25" name="minibarPar" type="number" min={0} max={99} defaultValue={g?.minibarPar || 2} /></div>
                  </div>
                ) : null}
                <label className="check"><input type="checkbox" name="trackStock" defaultChecked={g?.trackStock} />Lagerbestand führen</label>
                <div className="form-grid">
                  <div><label htmlFor="f01b26">Bestand</label><input id="f01b26" name="stock" type="number" defaultValue={g?.stock ?? 0} /></div>
                  <div><label htmlFor="f01b27">Mindestbestand</label><input id="f01b27" name="minStock" type="number" min={0} defaultValue={g?.minStock ?? 0} /></div>
                </div>
                <DrawerActions submit={g ? "Speichern" : "Ware anlegen"} cancelHref={base} />
              </form>
              {g?.trackStock ? (
                <form action={receiveAction} className="inline-form">
                  <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={g.id} />
                  <div><label htmlFor="f01b28">Wareneingang (negativ = Korrektur)</label><input id="f01b28" name="delta" type="number" required style={{ width: 120 }} /></div>
                  <button className="btn secondary small">Buchen</button>
                </form>
              ) : null}
              {g ? (
                <form action={removeAction}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="id" value={g.id} /><ConfirmButton className="btn secondary danger-text" ask="Ware wirklich löschen? Bereits gebuchte Posten bleiben bestehen.">Ware löschen</ConfirmButton></form>
              ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}
