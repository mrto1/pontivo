"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openStore, type Store } from "./store";
import { afterPay, checkPay, isOpen, lineFor, mergeServer, openTotal, type CatalogItem, type LocalOrder } from "../../src/domain/pos-local";
import { METHODS, METHOD_LABEL, receiptNumber, type Method } from "../../src/domain/pos";
import { nextBonNo, type SyncOp, type SyncResult } from "../../src/domain/pos-offline";
import { formatChf } from "../../src/domain/money";

type Guest = { reference: string; name: string; room: string | null };
type Catalog = { items: CatalogItem[]; tables: { id: string; name: string }[]; guests: Guest[]; today: string; vatLiable: boolean };
type DeviceInfo = { code: string; label: string; mine: boolean; free: boolean };
type Queued = SyncOp & { seq?: number };
type Rejected = { id: string; kind: string; error: string; number?: string };
type Boot = { devices: DeviceInfo[]; device?: { code: string; lastBon: number }; today?: string; items?: CatalogItem[]; tables?: Catalog["tables"]; guests?: Guest[]; orders?: Omit<LocalOrder, "receipts">[]; vatLiable?: boolean; error?: string };

const uuid = () => crypto.randomUUID();
const keyOf = () => { try { let k = localStorage.getItem("pontivo-kasse-key"); if (!k) { k = uuid().replace(/-/g, ""); localStorage.setItem("pontivo-kasse-key", k); } return k; } catch { return uuid().replace(/-/g, ""); } };

/**
 * Kasse mit lokalem Speicher: alles wird zuerst im Browser festgehalten (IndexedDB) und danach übertragen. Ohne Verbindung geht Bestellen und
 * Kassieren (bar, Karte, TWINT, aufs Zimmer) weiter; Bon-Nummern vergibt das Gerät lückenlos. Der Server bucht Wiederholungen nie doppelt.
 */
export function OfflineKasse({ hotelId, vatLiable }: { hotelId: string; vatLiable: boolean }) {
  const store = useRef<Store | null>(null);
  const syncing = useRef(false);
  const rev = useRef(0); // zählt lokale Änderungen: ein Abgleich vom Server darf sie nie überschreiben
  const [phase, setPhase] = useState<"loading" | "pick" | "ready" | "error">("loading");
  const [msg, setMsg] = useState("");
  const [warn, setWarn] = useState("");
  const [online, setOnline] = useState(true);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [orders, setOrders] = useState<LocalOrder[]>([]);
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [mode, setMode] = useState<"dine_in" | "takeaway">("dine_in");
  const [method, setMethod] = useState<Method>("cash");
  const [paySel, setPaySel] = useState<Record<string, number>>({});
  const [guest, setGuest] = useState("");
  const [tip, setTip] = useState("");
  const [label, setLabel] = useState("");

  const refresh = useCallback(async () => {
    const s = store.current!;
    setOrders(await s.all<LocalOrder>("orders"));
    setPending((await s.all("queue")).length);
    setRejected(await s.all<Rejected>("rejected"));
  }, []);

  const call = useCallback(async (path: string, body: object): Promise<{ status: number; json: Boot & { results?: SyncResult[] } }> => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }, []);

  /** Daten vom Server holen (Katalog immer; offene Bestellungen nur, wenn nichts mehr zu übertragen ist) */
  const bootstrap = useCallback(async (deviceCode?: string): Promise<boolean> => {
    const s = store.current!;
    const r0 = rev.current;
    const { status, json } = await call("/api/pos/bootstrap", { hotelId, deviceKey: keyOf(), deviceCode });
    if (status === 401) { setMsg("Bitte neu anmelden (Verbindung nötig)."); return false; }
    if (status !== 200) { setMsg(json.error ?? "Nicht möglich."); return false; }
    setDevices(json.devices);
    if (!deviceCode || !json.device) return true;
    const catalog: Catalog = { items: json.items!, tables: json.tables!, guests: json.guests!, today: json.today!, vatLiable };
    await s.put("kv", catalog, "catalog");
    setCat(catalog);
    const lastLocal = (await s.get<number>("kv", "lastBon")) ?? 0;
    await s.put("kv", nextBonNo(lastLocal, json.device.lastBon) - 1, "lastBon");
    // Offene Bestellungen vom Server nur übernehmen, wenn nichts mehr zu übertragen ist und sich lokal nichts geändert hat, seit die Anfrage rausging
    if (!(await s.all<Queued>("queue")).length && rev.current === r0) await s.replace("orders", mergeServer([], json.orders ?? [], new Set<string>()));
    await refresh();
    return true;
  }, [call, hotelId, refresh, vatLiable]);

  const sync = useCallback(async () => {
    const s = store.current;
    if (!s || syncing.current || !navigator.onLine) return;
    const deviceCode = await s.get<string>("kv", "device");
    if (!deviceCode) return;
    syncing.current = true;
    try {
      for (;;) {
        const queue = (await s.all<Queued>("queue")).sort((a, b) => a.seq! - b.seq!);
        if (!queue.length) break;
        const batch = queue.slice(0, 50);
        const { status, json } = await call("/api/pos/sync", { hotelId, deviceKey: keyOf(), deviceCode, pending: queue.length, ops: batch.map(({ seq: _s, ...op }) => op) });
        if (status !== 200 || !json.results) { setWarn(status === 401 ? "Bitte neu anmelden, die Vorgänge bleiben gespeichert." : status === 409 ? (json.error ?? "Gerät belegt.") : "Übertragung fehlgeschlagen, wird wiederholt."); break; }
        for (const op of batch) {
          const res = json.results.find((r) => r.id === op.id);
          if (!res) continue;
          if (!res.ok) await s.put("rejected", { id: op.id, kind: op.kind, error: res.error ?? "abgelehnt", number: op.kind === "pay" ? receiptNumber(deviceCode, op.bonNo) : undefined } satisfies Rejected);
          await s.del("queue", op.seq!);
        }
        await refresh();
      }
      if (!(await s.all("queue")).length) { setWarn(""); await bootstrap(deviceCode); }
    } catch { /* offline: bleibt in der Warteschlange */ } finally { syncing.current = false; await refresh(); }
  }, [bootstrap, call, hotelId, refresh]);

  const enqueue = useCallback(async (op: SyncOp) => { rev.current++; await store.current!.put("queue", op); await refresh(); void sync(); }, [refresh, sync]);
  const save = useCallback(async (o: LocalOrder) => { rev.current++; await store.current!.put("orders", o); await refresh(); }, [refresh]);

  useEffect(() => {
    let off = false;
    (async () => {
      store.current = await openStore(hotelId);
      const s = store.current;
      setOnline(navigator.onLine);
      const dev = (await s.get<string>("kv", "device")) ?? null;
      const saved = (await s.get<Catalog>("kv", "catalog")) ?? null;
      setCode(dev); setCat(saved);
      await refresh();
      if (dev && saved) setPhase("ready");
      try {
        if (dev) { const ok = await bootstrap(dev); if (!off && !saved) setPhase(ok ? "ready" : "error"); void sync(); }
        else { const ok = await bootstrap(); if (!off) setPhase(ok ? "pick" : "error"); }
      } catch {
        if (!off && !(dev && saved)) { setMsg("Die erste Einrichtung braucht eine Verbindung."); setPhase("error"); }
      }
    })();
    const on = () => { setOnline(true); void sync(); }, offl = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", offl);
    const t = setInterval(() => void sync(), 20000);
    return () => { off = true; clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", offl); };
  }, [hotelId, bootstrap, refresh, sync]);

  async function pick(c: string) {
    const ok = await bootstrap(c);
    if (!ok) return;
    await store.current!.put("kv", c, "device");
    setCode(c); setPhase("ready");
  }

  const order = useMemo(() => orders.find((o) => o.id === cur) ?? null, [orders, cur]);
  const items = cat?.items ?? [];
  const byCategory = useMemo(() => { const m = new Map<string, CatalogItem[]>(); for (const i of items) m.set(i.category || "Weitere", [...(m.get(i.category || "Weitere") ?? []), i]); return [...m]; }, [items]);

  async function openOrder(tableId: string | null, lbl: string) {
    const o: LocalOrder = { id: uuid(), tableId, label: lbl.trim().slice(0, 60), lines: [], receipts: [] };
    await save(o);
    await enqueue({ kind: "order", id: o.id, tableId, label: o.label, at: Date.now() });
    setCur(o.id); setLabel(""); setPaySel({});
  }
  async function addItem(item: CatalogItem) {
    if (!order) return;
    const l = lineFor(item, qty, mode, uuid(), cat!.vatLiable);
    const fresh = (await store.current!.get<LocalOrder>("orders", order.id)) ?? order; // immer vom gespeicherten Stand ausgehen
    await save({ ...fresh, lines: [...fresh.lines, l] });
    await enqueue({ kind: "lines", id: uuid(), orderId: order.id, at: Date.now(), lines: [{ id: l.id, itemId: item.id, quantity: l.quantity, mode: l.mode, description: l.description, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps }] });
    setQty(1);
  }
  async function payNow() {
    if (!cur || !code) return;
    const order = await store.current!.get<LocalOrder>("orders", cur);
    if (!order) return;
    const sel = order.lines.flatMap((l) => { const q = paySel[l.id] ?? l.openQuantity; return q > 0 && l.openQuantity > 0 ? [{ lineId: l.id, quantity: q }] : []; });
    const c = checkPay(order, sel);
    if ("error" in c) { setMsg(c.error); return; }
    if (method === "room" && !guest) { setMsg("Bitte den Gast wählen."); return; }
    const tipRappen = tip ? Math.round(Number(tip.replace(",", ".")) * 100) : 0;
    if (!Number.isInteger(tipRappen) || tipRappen < 0) { setMsg("Trinkgeld ungültig."); return; }
    const s = store.current!;
    const bonNo = ((await s.get<number>("kv", "lastBon")) ?? 0) + 1;
    await s.put("kv", bonNo, "lastBon"); // zuerst die Nummer sichern, dann buchen: eine Nummer wird nie zweimal vergeben
    const number = receiptNumber(code, bonNo);
    await save(afterPay(order, sel, { number, totalRappen: c.totalRappen }));
    await enqueue({ kind: "pay", id: uuid(), orderId: order.id, receiptId: uuid(), bonNo, at: Date.now(), selection: sel, payments: [{ method, amountRappen: c.totalRappen }], tipRappen, bookingReference: method === "room" ? guest : "" });
    setMsg(`Bon ${number} über ${formatChf(c.totalRappen)} (${METHOD_LABEL[method]}) gebucht.`);
    setPaySel({}); setTip("");
  }
  async function dismiss(id: string) { await store.current!.del("rejected", id); await refresh(); }

  if (phase === "loading") return <p className="muted">Kasse wird geladen …</p>;
  if (phase === "error") return <p className="notice warn">{msg || "Nicht möglich."}</p>;
  if (phase === "pick") return (
    <div className="card stack">
      <h2>Dieses Gerät wählen</h2>
      <p className="small muted">Jedes Gerät hat einen eigenen Nummernkreis für die Bons. Ein Manager legt Geräte unter «Artikel» an.</p>
      {msg ? <p className="notice warn">{msg}</p> : null}
      {devices.length ? devices.filter((d) => d.free || d.mine).map((d) => <button key={d.code} className="btn secondary" onClick={() => pick(d.code)}>{d.code} {d.label}</button>) : <p className="muted">Noch kein Gerät angelegt.</p>}
    </div>
  );

  const openOrders = orders.filter(isOpen);
  return (
    <div className="stack">
      <div className={`notice ${online ? "" : "warn"}`} role="status" data-testid="status">
        {online ? "Online" : "Ohne Verbindung"} · Gerät {code} · {pending ? `${pending} Vorgänge noch nicht übertragen` : "alles übertragen"}
      </div>
      {rejected.map((r) => (
        <p key={r.id} className="notice warn">{r.number ? `Bon ${r.number}` : "Vorgang"} wurde vom Server abgelehnt: {r.error} <button className="btn secondary small" onClick={() => dismiss(r.id)}>Gelesen</button></p>
      ))}
      {warn ? <p className="notice warn">{warn}</p> : null}
      {msg ? <p className="notice" data-testid="msg">{msg}</p> : null}
      {!order ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {(cat?.tables ?? []).map((t) => {
              const mine = openOrders.filter((o) => o.tableId === t.id);
              return (
                <div key={t.id} className="card stack">
                  <strong>{t.name}</strong>
                  {mine.map((o) => <button key={o.id} className="btn secondary small" onClick={() => { setCur(o.id); setPaySel({}); setMsg(""); }}>offen {formatChf(openTotal(o))}</button>)}
                  <button className="btn small" onClick={() => openOrder(t.id, "")}>{mine.length ? "Weitere" : "Eröffnen"}</button>
                </div>
              );
            })}
          </div>
          {openOrders.filter((o) => !o.tableId).map((o) => <button key={o.id} className="btn secondary" onClick={() => { setCur(o.id); setPaySel({}); setMsg(""); }}>{o.label || "Ohne Tisch"}: offen {formatChf(openTotal(o))}</button>)}
          <div className="card stack">
            <label htmlFor="lbl">Ohne Tisch (z. B. «Bar», «Take-away Meier»)</label>
            <input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
            <div><button className="btn" onClick={() => openOrder(null, label)}>Bestellung eröffnen</button></div>
          </div>
        </>
      ) : (
        <>
          <p><button className="btn secondary small" onClick={() => { setCur(null); setMsg(""); }}>← Alle Tische</button> <strong>{order.label || cat?.tables.find((t) => t.id === order.tableId)?.name || "Bestellung"}</strong></p>
          <div className="card stack">
            <div><label htmlFor="mode">Art</label> <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as "dine_in" | "takeaway")}><option value="dine_in">Im Haus</option><option value="takeaway">Take-away</option></select>
              {" "}<label htmlFor="qty">Menge</label> <input id="qty" type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} style={{ width: 70 }} /></div>
            {byCategory.map(([c, list]) => (
              <div key={c}><strong className="small muted">{c}</strong><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {list.map((i) => <button key={i.id} className="btn secondary" onClick={() => addItem(i)}>{i.name} {formatChf(i.priceRappen)}</button>)}
              </div></div>
            ))}
          </div>
          <div className="card stack">
            <h2>Bezahlen</h2>
            {order.lines.length ? (
              <table className="table"><thead><tr><th>Posten</th><th>Preis</th><th>Offen</th><th>Jetzt</th></tr></thead><tbody>
                {order.lines.map((l) => (
                  <tr key={l.id}><td>{l.description}{l.mode === "takeaway" ? " (Take-away)" : ""}</td><td>{formatChf(l.unitPriceRappen)}</td><td>{l.openQuantity}</td>
                    <td>{l.openQuantity ? <input type="number" min={0} max={l.openQuantity} value={paySel[l.id] ?? l.openQuantity} onChange={(e) => setPaySel({ ...paySel, [l.id]: Math.max(0, Math.min(l.openQuantity, Number(e.target.value) || 0)) })} style={{ width: 70 }} aria-label={`Menge ${l.description}`} /> : "bezahlt"}</td></tr>
                ))}
              </tbody></table>
            ) : <p className="muted">Noch nichts bestellt.</p>}
            <p><strong>Noch offen: {formatChf(openTotal(order))}</strong></p>
            <div><label htmlFor="method">Zahlart</label> <select id="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
            {method === "room" ? (
              <div><label htmlFor="guest">Gast im Haus</label> <select id="guest" value={guest} onChange={(e) => setGuest(e.target.value)}>
                <option value="">bitte wählen</option>{(cat?.guests ?? []).map((g) => <option key={g.reference} value={g.reference}>{g.room ? `Zimmer ${g.room}: ` : ""}{g.name || g.reference} ({g.reference})</option>)}
              </select><p className="small muted">Stand der Gästeliste: {cat?.today}. Ohne Verbindung prüft der Server die Buchung erst später.</p></div>
            ) : null}
            <div><label htmlFor="tip">Trinkgeld CHF</label> <input id="tip" value={tip} onChange={(e) => setTip(e.target.value)} inputMode="decimal" style={{ width: 90 }} /></div>
            <div><button className="btn" onClick={payNow} disabled={!openTotal(order)}>Kassieren</button></div>
            <p className="small muted">Karte und TWINT: erst kassieren, wenn die Zahlung am Gerät bestätigt ist.</p>
            {order.receipts.length ? <p className="small muted">Bons: {order.receipts.map((r) => `${r.number} (${formatChf(r.totalRappen)})`).join(", ")}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
