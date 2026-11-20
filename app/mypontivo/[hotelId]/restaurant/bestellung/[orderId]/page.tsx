import { notFound, redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, addDiscount, addLines, listItems, orderView, pay, reverseLine, reverseReceipt, webDevice } from "@/src/services/pos";
import { METHODS, METHOD_LABEL, selectionTotal, type Method } from "@/src/domain/pos";
import { atLeast } from "@/src/domain/roles";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const chf = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
const back = (h: string, o: string, msg: string) => redirect(`/mypontivo/${h}/restaurant/bestellung/${o}?msg=${encodeURIComponent(msg)}`);

async function guard(f: FormData, manager = false) {
  const c = manager ? await requireHotel(s(f, "hotelId"), "manager") : await requireHotel(s(f, "hotelId"), "staff", "restaurant");
  await requireModule(c.hotel.id, "pos");
  return c;
}
async function add(f: FormData) {
  "use server";
  const c = await guard(f);
  const o = s(f, "orderId");
  try {
    await addLines(c.hotel, o, [{ itemId: s(f, "itemId"), quantity: Number(s(f, "quantity") || 1), mode: s(f, "mode") === "takeaway" ? "takeaway" : "dine_in" }], c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, o, `Nicht hinzugefügt: ${e.message}`); }
  redirect(`/mypontivo/${c.hotel.id}/restaurant/bestellung/${o}`);
}
async function payAction(f: FormData) {
  "use server";
  const c = await guard(f);
  const o = s(f, "orderId");
  const v = await orderView(c.hotel.id, o);
  if (!v) notFound();
  const sel = v.lines.flatMap(({ line }) => { const q = Number(s(f, `q_${line.id}`) || 0); return q ? [{ lineId: line.id, quantity: q }] : []; });
  const method = s(f, "method") as Method;
  try {
    if (!sel.length) throw new PosError("Nichts zum Bezahlen gewählt.");
    if (!METHODS.includes(method)) throw new PosError("Zahlart ungültig.");
    const byId = new Map(v.lines.map((l) => [l.line.id, l.line]));
    if (sel.some((x) => !byId.has(x.lineId))) throw new PosError("Zeile unbekannt.");
    const total = selectionTotal(sel.map((x) => byId.get(x.lineId)!), sel).totalRappen;
    const dev = await webDevice(c.hotel.id);
    const r = await pay(c.hotel, { orderId: o, deviceId: dev.id, selection: sel, payments: [{ method, amountRappen: total }], tipRappen: s(f, "tip") ? chf(s(f, "tip")) : 0, bookingReference: s(f, "reference") }, c.actor);
    back(c.hotel.id, o, `Bon ${r.number} über ${formatChf(r.totalRappen)} gebucht.`);
  } catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, o, `Nicht bezahlt: ${e.message}`); }
}
async function discount(f: FormData) {
  "use server";
  const c = await guard(f, true);
  const o = s(f, "orderId");
  try {
    await addDiscount(c.hotel, o, { description: s(f, "description") || "Rabatt", amountRappen: chf(s(f, "amount")), vatBps: Number(s(f, "vat") || 810), reason: s(f, "reason") }, c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, o, `Kein Rabatt: ${e.message}`); }
  redirect(`/mypontivo/${c.hotel.id}/restaurant/bestellung/${o}`);
}
async function storno(f: FormData) {
  "use server";
  const c = await guard(f, true);
  const o = s(f, "orderId");
  try { await reverseLine(c.hotel.id, s(f, "lineId"), Number(s(f, "quantity") || 1), s(f, "reason"), c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, o, `Nicht storniert: ${e.message}`); }
  redirect(`/mypontivo/${c.hotel.id}/restaurant/bestellung/${o}`);
}
async function gegenbon(f: FormData) {
  "use server";
  const c = await guard(f, true);
  const o = s(f, "orderId");
  try {
    const dev = await webDevice(c.hotel.id);
    const g = await reverseReceipt(c.hotel, s(f, "receiptId"), dev.id, s(f, "reason"), c.actor);
    back(c.hotel.id, o, `Gegenbon ${g.number} gebucht.`);
  } catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, o, `Kein Gegenbon: ${e.message}`); }
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ hotelId: string; orderId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId, orderId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "staff", "restaurant");
  await requireModule(hotel.id, "pos");
  const v = await orderView(hotel.id, orderId);
  if (!v) notFound();
  const items = (await listItems(hotel.id, true));
  const manager = atLeast(role, "manager");
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const O = <input type="hidden" name="orderId" value={orderId} />;
  return (
    <div className="stack">
      <h1>Bestellung {v.order.label || ""}</h1>
      {sp.msg ? <p className={`notice ${/^(Nicht|Kein)/.test(sp.msg) ? "warn" : ""}`}>{sp.msg}</p> : null}
      <form action={add} className="card stack">
        {H}{O}
        <div><label htmlFor="itemId">Artikel</label>
          <select id="itemId" name="itemId" required>{items.map((i) => <option key={i.id} value={i.id}>{i.category ? `${i.category}: ` : ""}{i.name} ({formatChf(i.priceRappen)})</option>)}</select></div>
        <div><label htmlFor="quantity">Menge</label><input id="quantity" name="quantity" type="number" min={1} defaultValue={1} /></div>
        <div><label htmlFor="mode">Art</label><select id="mode" name="mode"><option value="dine_in">Im Haus</option><option value="takeaway">Take-away</option></select></div>
        <div><button className="btn">Hinzufügen</button></div>
      </form>
      <form action={payAction} className="card stack">
        {H}{O}
        <h2>Bezahlen</h2>
        <p className="small muted">Menge je Zeile = was jetzt bezahlt wird (0 = später). So geht Getrennt-Zahlen.</p>
        {v.lines.length ? (
          <table className="table"><thead><tr><th>Posten</th><th>Preis</th><th>Offen</th><th>Jetzt</th></tr></thead><tbody>
            {v.lines.map(({ line, openQuantity }) => (
              <tr key={line.id}><td>{line.description}</td><td>{formatChf(line.unitPriceRappen)}</td><td>{openQuantity}</td>
                <td>{openQuantity ? <input name={`q_${line.id}`} type="number" min={0} max={openQuantity} defaultValue={openQuantity} style={{ width: 70 }} /> : "bezahlt"}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Noch nichts bestellt.</p>}
        <p><strong>Noch offen: {formatChf(v.openTotalRappen)}</strong></p>
        <div><label htmlFor="method">Zahlart</label><select id="method" name="method">{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
        <div><label htmlFor="reference">Buchungsnummer (nur «Aufs Zimmer»)</label><input id="reference" name="reference" maxLength={20} /></div>
        <div><label htmlFor="tip">Trinkgeld CHF (nicht aufs Zimmer mit MWST)</label><input id="tip" name="tip" inputMode="decimal" /></div>
        <div><button className="btn" disabled={!v.openTotalRappen}>Kassieren</button></div>
        <p className="small muted">Karte und TWINT: bitte erst kassieren, wenn die Zahlung am Gerät bestätigt ist.</p>
      </form>
      {manager ? (
        <section className="card stack">
          <h2>Manager</h2>
          <form action={discount} className="stack">
            {H}{O}
            <div><label>Rabatt (Text)</label><input name="description" maxLength={80} defaultValue="Rabatt" /></div>
            <div><label>Betrag CHF</label><input name="amount" inputMode="decimal" required /></div>
            <div><label>MWST-Satz in Basispunkten (810 = 8,1 %)</label><input name="vat" type="number" defaultValue={810} /></div>
            <div><label>Grund (Pflicht)</label><input name="reason" required maxLength={200} /></div>
            <div><button className="btn secondary">Rabatt buchen</button></div>
          </form>
          {v.lines.filter((l) => l.openQuantity > 0 && l.line.quantity > 0).map(({ line, openQuantity }) => (
            <form key={line.id} action={storno} className="stack">
              {H}{O}<input type="hidden" name="lineId" value={line.id} />
              <div><label>«{line.description}» stornieren (offen {openQuantity})</label>
                <input name="quantity" type="number" min={1} max={openQuantity} defaultValue={1} style={{ width: 70 }} /> <input name="reason" placeholder="Grund" required maxLength={200} /> <button className="btn secondary small">Stornieren</button></div>
            </form>
          ))}
        </section>
      ) : null}
      {v.receipts.length ? (
        <section className="card stack">
          <h2>Bons</h2>
          <table className="table"><tbody>
            {v.receipts.map((r) => (
              <tr key={r.id}><td>{r.number}</td><td>{r.kind === "sale" ? "Verkauf" : "Gegenbon"}</td><td>{formatChf(r.totalRappen)}</td><td>{r.paidAt.toLocaleString("de-CH")}</td>
                <td>{manager && r.kind === "sale" ? (
                  <form action={gegenbon}>{H}{O}<input type="hidden" name="receiptId" value={r.id} /><input name="reason" placeholder="Grund" required maxLength={200} /> <button className="btn secondary small">Gegenbon</button></form>
                ) : null}</td></tr>
            ))}
          </tbody></table>
        </section>
      ) : null}
    </div>
  );
}
