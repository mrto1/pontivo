import { Notice } from "@/components/admin/Notice";
import { notFound, redirect } from "next/navigation";
import { requireHotelModule } from "@/src/auth/guard";
import { remoteGuests } from "@/src/services/room-link";
import { PosError, addDiscount, addLines, groupsOfItem, listItems, orderView, pay, reverseLine, reverseReceipt, webDevice } from "@/src/services/pos";
import { METHODS, METHOD_LABEL, selectionTotal, type Method } from "@/src/domain/pos";
import { atLeast } from "@/src/domain/roles";
import { formatChf } from "@/src/domain/money";
import { db } from "@/src/db/client";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";
const chf = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
const back = (h: string, o: string, msg: string) => redirect(`/admin/${h}/restaurant/bestellung/${o}?msg=${encodeURIComponent(msg)}`);

async function guard(f: FormData, manager = false) {
  const c = manager ? await requireHotelModule("pos", s(f, "hotelId"), "manager") : await requireHotelModule("pos", s(f, "hotelId"), "staff", "restaurant");
  return c;
}
async function add(f: FormData) {
  "use server";
  const c = await guard(f);
  const o = s(f, "orderId");
  const itemId = s(f, "itemId"), quantity = Number(s(f, "quantity") || 1), mode = s(f, "mode") === "takeaway" ? "takeaway" : "dine_in";
  // Hat der Artikel Optionen und wurden noch keine gewählt, erst die Auswahl zeigen (SPEC 19.49)
  if (s(f, "step") !== "options" && (await groupsOfItem(db(), c.hotel.id, itemId)).length)
    redirect(`/admin/${c.hotel.id}/restaurant/bestellung/${o}?artikel=${encodeURIComponent(itemId)}&menge=${quantity}&art=${mode}&note=${encodeURIComponent(s(f, "note"))}`);
  try {
    await addLines(c.hotel, o, [{ itemId, quantity, mode, optionIds: f.getAll("opt").map(String), note: s(f, "note") }], c.actor);
  } catch (e) {
    if (!(e instanceof PosError)) throw e;
    if (s(f, "step") === "options") redirect(`/admin/${c.hotel.id}/restaurant/bestellung/${o}?artikel=${encodeURIComponent(itemId)}&menge=${quantity}&art=${mode}&note=${encodeURIComponent(s(f, "note"))}&msg=${encodeURIComponent(`Nicht hinzugefügt: ${e.message}`)}`);
    back(c.hotel.id, o, `Nicht hinzugefügt: ${e.message}`);
  }
  redirect(`/admin/${c.hotel.id}/restaurant/bestellung/${o}`);
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
  redirect(`/admin/${c.hotel.id}/restaurant/bestellung/${o}`);
}
async function storno(f: FormData) {
  "use server";
  const c = await guard(f, true);
  const o = s(f, "orderId");
  try { await reverseLine(c.hotel.id, s(f, "lineId"), Number(s(f, "quantity") || 1), s(f, "reason"), c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; back(c.hotel.id, o, `Nicht storniert: ${e.message}`); }
  redirect(`/admin/${c.hotel.id}/restaurant/bestellung/${o}`);
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
  const { hotel, role } = await requireHotelModule("pos", hotelId, "staff", "restaurant");
  const v = await orderView(hotel.id, orderId);
  if (!v) notFound();
  const items = (await listItems(hotel.id, true));
  const linked = await remoteGuests(hotel.id); // Gäste des verbundenen Hotels (SPEC 20.10)
  const manager = atLeast(role, "manager");
  const pick = sp.artikel ? items.find((i) => i.id === sp.artikel) : undefined;
  const pickGroups = pick ? await groupsOfItem(db(), hotel.id, pick.id) : [];
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const O = <input type="hidden" name="orderId" value={orderId} />;
  return (
    <div className="stack">
      <h1>Bestellung {v.order.label || ""}</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {pick && pickGroups.length ? (
        <form key={`${pick.id}-${sp.msg ?? ""}-${sp.note ?? ""}`} action={add} className="card stack" data-testid="options-step">
          {H}{O}<input type="hidden" name="step" value="options" /><input type="hidden" name="itemId" value={pick.id} />
          <input type="hidden" name="quantity" value={Math.max(1, Number(sp.menge) || 1)} /><input type="hidden" name="mode" value={sp.art === "takeaway" ? "takeaway" : "dine_in"} />
          <h2>{pick.name}</h2>
          {pickGroups.map((g) => (
            <fieldset key={g.id} className="stack">
              <legend><strong>{g.name}</strong> <span className="small muted">{g.required ? "Pflicht" : "optional"}{g.maxChoices > 1 ? ` · bis zu ${g.maxChoices}` : ""}</span></legend>
              {g.options.map((o) => (
                <label key={o.id} className="opt-row"><input type={g.maxChoices === 1 ? "radio" : "checkbox"} name="opt" value={o.id} /> {o.name}{o.priceRappen ? ` (+${formatChf(o.priceRappen)})` : ""}</label>
              ))}
            </fieldset>
          ))}
          <div><label htmlFor="note">Sonderwunsch</label><input id="note" name="note" defaultValue={sp.note ?? ""} maxLength={120} placeholder="z. B. ohne Zwiebeln" /></div>
          <div><button className="btn">Hinzufügen</button></div>
        </form>
      ) : null}
      <form action={add} className="card stack">
        {H}{O}
        <div><label htmlFor="itemId">Artikel</label>
          <select id="itemId" name="itemId" required>{items.map((i) => <option key={i.id} value={i.id}>{i.category ? `${i.category}: ` : ""}{i.name} ({formatChf(i.priceRappen)})</option>)}</select></div>
        <div><label htmlFor="quantity">Menge</label><input id="quantity" name="quantity" type="number" min={1} defaultValue={1} /></div>
        <div><label htmlFor="mainnote">Sonderwunsch (optional)</label><input id="mainnote" name="note" maxLength={120} placeholder="z. B. ohne Zwiebeln" /></div>
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
                <td>{openQuantity ? <input name={`q_${line.id}`} type="number" min={0} max={openQuantity} defaultValue={openQuantity} className="w70" /> : "bezahlt"}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Noch nichts bestellt.</p>}
        <p><strong>Noch offen: {formatChf(v.openTotalRappen)}</strong></p>
        <div><label htmlFor="method">Zahlart</label><select id="method" name="method">{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
        <div><label htmlFor="reference">Buchungsnummer (nur «Aufs Zimmer»)</label><input id="reference" name="reference" maxLength={20} list={linked.length ? "linked-guests" : undefined} />
          {linked.length ? <datalist id="linked-guests">{linked.map((g) => <option key={g.reference} value={g.reference}>{g.room ? `Zimmer ${g.room}: ` : ""}{g.name}</option>)}</datalist> : null}</div>
        <div><label htmlFor="tip">Trinkgeld CHF (nicht aufs Zimmer mit MWST)</label><input id="tip" name="tip" inputMode="decimal" /></div>
        <div><button className="btn" disabled={!v.openTotalRappen}>Kassieren</button></div>
        <p className="small muted">Karte und TWINT: bitte erst kassieren, wenn die Zahlung am Gerät bestätigt ist.</p>
      </form>
      {manager ? (
        <section className="card stack">
          <h2>Manager</h2>
          <form action={discount} className="stack">
            {H}{O}
            <div><label htmlFor="fcb081">Rabatt (Text)</label><input id="fcb081" name="description" maxLength={80} defaultValue="Rabatt" /></div>
            <div><label htmlFor="fcb082">Betrag CHF</label><input id="fcb082" name="amount" inputMode="decimal" required /></div>
            <div><label htmlFor="fcb083">MWST-Satz in Basispunkten (810 = 8,1 %)</label><input id="fcb083" name="vat" type="number" defaultValue={810} /></div>
            <div><label htmlFor="fcb084">Grund (Pflicht)</label><input id="fcb084" name="reason" required maxLength={200} /></div>
            <div><button className="btn secondary">Rabatt buchen</button></div>
          </form>
          {v.lines.filter((l) => l.openQuantity > 0 && l.line.quantity > 0).map(({ line, openQuantity }) => (
            <form key={line.id} action={storno} className="stack">
              {H}{O}<input type="hidden" name="lineId" value={line.id} />
              <div><label htmlFor={`sq-${line.id}`}>«{line.description}» stornieren (offen {openQuantity})</label>
                <div className="inline-form"><input id={`sq-${line.id}`} name="quantity" type="number" min={1} max={openQuantity} defaultValue={1} className="w70" /> <input name="reason" placeholder="Grund" aria-label={`Grund für Storno ${line.description}`} required maxLength={200} className="flex1" /> <button className="btn secondary small">Stornieren</button></div></div>
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
