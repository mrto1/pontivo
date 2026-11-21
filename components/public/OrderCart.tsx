"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/src/i18n/dict";
import { ORD } from "@/src/i18n/order";
import { ALLERGEN_LABEL, deliveryFee, zoneFor, type Allergen } from "@/src/domain/online-order";
import { formatChf } from "@/src/domain/money";
import { orderAction } from "./order-actions";

type Opt = { id: string; name: string; priceRappen: number };
type Group = { id: string; name: string; required: boolean; maxChoices: number; options: Opt[] };
export type MenuItem = { id: string; category: string | null; name: string; description: string; priceRappen: number; photoUrl: string | null; allergens: string[]; groups: Group[] };
export type Zone = { id: string; name: string; active: boolean; postalCodes: string[]; minOrderRappen: number; feeRappen: number; freeFromRappen: number | null; extraMinutes: number; slots: string[] };
type Line = { key: string; itemId: string; quantity: number; optionIds: string[]; note: string };
type Saved = { lines: Line[]; kind: "pickup" | "delivery"; contact: Record<string, string> };

const FIELDS = ["name", "phone", "email", "street", "houseNo", "postalCode", "city", "floor", "bell", "hint"] as const;

/** Speisekarte mit Warenkorb im Browser und Bestellformular (SPEC 20.4/20.5) */
export function OrderCart(p: {
  hotelId: string; locale: Locale; base: string; menu: MenuItem[]; phone: string | null; msg: string | null; aborted: boolean;
  pickup: { on: boolean; slots: string[]; cash: boolean }; delivery: { on: boolean; zones: Zone[]; cash: boolean; cashMaxRappen: number | null }; cardOk: boolean;
}) {
  const t = ORD[p.locale];
  const store = `pv_cart_${p.hotelId}`;
  const [lines, setLines] = useState<Line[]>([]);
  const [kind, setKind] = useState<"pickup" | "delivery">(p.pickup.on ? "pickup" : "delivery");
  const [c, setC] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [hits, setHits] = useState<{ label: string; street: string; houseNo: string; postalCode: string; city: string }[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(store) ?? "null") as Saved | null;
      if (v && Array.isArray(v.lines)) {
        const ids = new Set(p.menu.map((m) => m.id));
        setLines(v.lines.filter((l) => ids.has(l.itemId)));
        if (v.kind === "delivery" && p.delivery.on) setKind("delivery");
        if (v.kind === "pickup" && p.pickup.on) setKind("pickup");
        setC(v.contact ?? {});
      }
    } catch { /* ohne Speicher weiter */ }
    loaded.current = true;
  }, [store, p.menu, p.delivery.on, p.pickup.on]);
  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(store, JSON.stringify({ lines, kind, contact: c } satisfies Saved)); } catch { /* egal */ }
  }, [store, lines, kind, c]);

  const byId = useMemo(() => new Map(p.menu.map((m) => [m.id, m])), [p.menu]);
  const price = (l: Line) => {
    const it = byId.get(l.itemId);
    if (!it) return 0;
    const extra = it.groups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).reduce((a, o) => a + o.priceRappen, 0);
    return (it.priceRappen + extra) * l.quantity;
  };
  const subtotal = lines.reduce((a, l) => a + price(l), 0);
  const zone = kind === "delivery" && /^\d{4}$/.test(c.postalCode ?? "") ? zoneFor(p.delivery.zones, c.postalCode) : null;
  const fee = zone ? deliveryFee(zone, subtotal) : 0;
  const total = subtotal + fee;
  const slots = kind === "pickup" ? p.pickup.slots : zone?.slots ?? [];
  const cashOk = kind === "pickup" ? p.pickup.cash : p.delivery.cash && (p.delivery.cashMaxRappen === null || total <= p.delivery.cashMaxRappen);
  const tooSmall = !!zone && subtotal < zone.minOrderRappen;
  const canSend = lines.length > 0 && slots.length > 0 && (kind === "pickup" || (!!zone && !tooSmall)) && (p.cardOk || cashOk);

  const add = (it: MenuItem, optionIds: string[], n: string) => setLines((ls) => {
    const same = ls.find((l) => l.itemId === it.id && l.note === n && l.optionIds.join() === optionIds.join());
    if (same) return ls.map((l) => (l === same ? { ...l, quantity: Math.min(50, l.quantity + 1) } : l));
    return [...ls, { key: crypto.randomUUID(), itemId: it.id, quantity: 1, optionIds, note: n }];
  });
  const qty = (key: string, d: number) => setLines((ls) => ls.flatMap((l) => (l.key !== key ? [l] : l.quantity + d <= 0 ? [] : [{ ...l, quantity: Math.min(50, l.quantity + d) }])));
  const choiceOk = (it: MenuItem) => it.groups.every((g) => { const n = g.options.filter((o) => pick.includes(o.id)).length; return (!g.required || n > 0) && n <= g.maxChoices; });
  const toggle = (g: Group, id: string) => setPick((ps) => {
    if (g.maxChoices === 1) return [...ps.filter((x) => !g.options.some((o) => o.id === x)), id];
    return ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id];
  });

  // Adresse vervollständigen über geo.admin.ch (ab 3 Zeichen, 300 ms nach dem Tippen)
  const [q, setQ] = useState("");
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`https://api3.geo.admin.ch/rest/services/ech/SearchServer?type=locations&origins=address&limit=6&sr=4326&searchText=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: { attrs?: { label?: string } }[] }) => setHits((d.results ?? []).map((x) => parseLabel(x.attrs?.label ?? "")).filter((x): x is NonNullable<typeof x> => !!x)))
        .catch(() => setHits([]));
    }, 300);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);

  const cats = [...new Set(p.menu.map((m) => m.category || ""))];
  const set = (k: string) => (e: { target: { value: string } }) => setC((x) => ({ ...x, [k]: e.target.value }));
  const F = (k: (typeof FIELDS)[number], o: { req?: boolean; type?: string; w?: number; ac?: string; label?: string } = {}) => (
    <div style={o.w ? { width: o.w } : { flex: 1, minWidth: 140 }}><label htmlFor={`o-${k}`}>{o.label ?? t[k]}</label>
      <input id={`o-${k}`} name={k} required={o.req} type={o.type ?? "text"} autoComplete={o.ac} value={c[k] ?? ""} onChange={set(k)} maxLength={k === "hint" ? 200 : 120} /></div>
  );

  return (
    <div className="order-layout">
      <div className="stack">
        {p.aborted ? <p className="notice warn">{t.aborted}</p> : null}
        {p.msg ? <p className="notice error" role="alert">{p.msg}</p> : null}
        {cats.map((cat) => (
          <section key={cat} className="stack">
            {cat ? <h2>{cat}</h2> : null}
            {p.menu.filter((m) => (m.category || "") === cat).map((it) => (
              <article key={it.id} className="card order-item" data-testid={`menu-${it.name}`}>
                {it.photoUrl ? <img src={it.photoUrl} alt="" loading="lazy" className="order-photo" /> : null}
                <div className="stack" style={{ flex: 1, gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{it.name}</strong><span>{formatChf(it.priceRappen)}</span></div>
                  {it.description ? <p className="small muted" style={{ margin: 0 }}>{it.description}</p> : null}
                  {it.allergens.length ? <p className="small" style={{ margin: 0 }}>{t.allergens}: {it.allergens.map((a) => ALLERGEN_LABEL[a as Allergen]?.[p.locale] ?? a).join(", ")}</p> : null}
                  {open === it.id ? (
                    <div className="stack">
                      {it.groups.map((g) => (
                        <fieldset key={g.id}><legend className="small">{g.name}{g.required ? ` (${t.required})` : ""}</legend>
                          {g.options.map((o) => <label key={o.id} className="opt-row"><input type={g.maxChoices === 1 ? "radio" : "checkbox"} name={`g-${it.id}-${g.id}`} checked={pick.includes(o.id)} onChange={() => toggle(g, o.id)} /> {o.name}{o.priceRappen ? ` +${formatChf(o.priceRappen)}` : ""}</label>)}
                        </fieldset>
                      ))}
                      <div><label htmlFor={`n-${it.id}`}>{t.special}</label><input id={`n-${it.id}`} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} /></div>
                      <div className="inline-form"><button type="button" className="btn small" disabled={!choiceOk(it)} onClick={() => { add(it, pick, note.trim()); setOpen(null); }}>{t.add}</button>
                        <button type="button" className="btn secondary small" onClick={() => setOpen(null)}>×</button></div>
                    </div>
                  ) : (
                    <div className="inline-form">
                      {it.groups.length ? null : <button type="button" className="btn small" onClick={() => add(it, [], "")} aria-label={`${it.name} ${t.add}`}>{t.add}</button>}
                      <button type="button" className={it.groups.length ? "btn small" : "btn secondary small"} onClick={() => { setOpen(it.id); setPick([]); setNote(""); }}>{it.groups.length ? t.add : t.special}</button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>
        ))}
        <p className="small muted">{t.allergenCall}{p.phone ? <> <a href={`tel:${p.phone}`}>{p.phone}</a></> : null}</p>
      </div>

      <form action={orderAction} className="card stack order-cart" data-testid="order-form">
        <input type="hidden" name="hotelId" value={p.hotelId} /><input type="hidden" name="locale" value={p.locale} /><input type="hidden" name="base" value={p.base} />
        <input type="hidden" name="cart" value={JSON.stringify(lines.map(({ itemId, quantity, optionIds, note }) => ({ itemId, quantity, optionIds, note })))} />
        <input type="hidden" name="kind" value={kind} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
        <h2>{t.cart}</h2>
        {p.pickup.on && p.delivery.on ? (
          <div className="seg" role="radiogroup" aria-label={t.cart}>
            <label><input type="radio" name="kindPick" checked={kind === "pickup"} onChange={() => setKind("pickup")} />{t.pickup}</label>
            <label><input type="radio" name="kindPick" checked={kind === "delivery"} onChange={() => setKind("delivery")} />{t.delivery}</label>
          </div>
        ) : <p className="small"><strong>{kind === "pickup" ? t.pickup : t.delivery}</strong></p>}
        {lines.length ? (
          <ul className="list" data-testid="cart-lines">
            {lines.map((l) => {
              const it = byId.get(l.itemId)!;
              const opts = it.groups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).map((o) => o.name);
              return (
                <li key={l.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flex: 1 }}>{l.quantity} × {it.name}{opts.length ? <span className="small"> ({opts.join(", ")})</span> : null}{l.note ? <span className="small muted"> – {l.note}</span> : null}</span>
                  <button type="button" className="btn secondary small" onClick={() => qty(l.key, -1)} aria-label={t.remove}>−</button>
                  <button type="button" className="btn secondary small" onClick={() => qty(l.key, 1)} aria-label="+">+</button>
                  <span className="small">{formatChf(price(l))}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted small">{t.empty}</p>}

        {kind === "delivery" ? (
          <fieldset className="stack">
            <div><label htmlFor="o-search">{t.addrSearch}</label>
              <input id="o-search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Bahnhofstrasse 1, 9000" />
              <p className="small muted" style={{ margin: "2px 0 0" }}>{t.swisstopo}</p>
              {hits.length ? <ul className="list" data-testid="addr-hits">{hits.map((h) => <li key={h.label}><button type="button" className="link-btn" onClick={() => { setC((x) => ({ ...x, street: h.street, houseNo: h.houseNo, postalCode: h.postalCode, city: h.city })); setHits([]); setQ(""); }}>{h.label}</button></li>)}</ul> : null}
            </div>
            <div className="inline-form">{F("street", { req: true, ac: "address-line1" })}{F("houseNo", { req: true, w: 80 })}</div>
            <div className="inline-form">{F("postalCode", { req: true, w: 90, ac: "postal-code" })}{F("city", { req: true, ac: "address-level2" })}</div>
            {/^\d{4}$/.test(c.postalCode ?? "") ? (zone ? <p className="small">{zone.name}: {t.deliveryFee} {formatChf(zone.feeRappen)}{zone.freeFromRappen !== null ? `, ${t.freeFrom(formatChf(zone.freeFromRappen))}` : ""}{zone.minOrderRappen ? ` · ${t.minOrder(formatChf(zone.minOrderRappen))}` : ""}</p> : <p className="notice warn small">{t.noDelivery(c.postalCode)}</p>) : null}
            <div className="inline-form">{F("floor")}{F("bell")}</div>
            {F("hint")}
          </fieldset>
        ) : null}

        <div><label htmlFor="o-time">{t.time}</label>
          {slots.length ? <select id="o-time" name="time" defaultValue="asap"><option value="asap">{t.asap} ({slots[0]})</option>{slots.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            : kind === "delivery" && !zone ? <p className="small muted">{t.addrFirst}</p> : <p className="notice warn small">{t.noSlots}</p>}
        </div>
        <div className="inline-form">{F("name", { req: true, ac: "name" })}{F("phone", { req: true, type: "tel", ac: "tel" })}</div>
        {F("email", { type: "email", ac: "email" })}
        <p className="small muted" style={{ margin: 0 }}>{t.emailHint}</p>
        <div><label htmlFor="o-note">{t.note}</label><input id="o-note" name="note" maxLength={300} /></div>

        <div className="kv small">
          <span>{t.subtotal}</span><span>{formatChf(subtotal)}</span>
          {kind === "delivery" && zone ? <><span>{t.deliveryFee}</span><span>{formatChf(fee)}</span></> : null}
          <strong>{t.total}</strong><strong data-testid="order-total">{formatChf(total)}</strong>
        </div>
        {tooSmall ? <p className="notice warn small">{t.minOrder(formatChf(zone!.minOrderRappen))}</p> : null}
        <fieldset><legend className="small">{t.payment}</legend>
          {p.cardOk ? <label className="opt-row"><input type="radio" name="payment" value="card" defaultChecked /> {t.payCard}</label> : null}
          {cashOk ? <label className="opt-row"><input type="radio" name="payment" value="cash" defaultChecked={!p.cardOk} /> {kind === "pickup" ? t.cashPickup : t.cashDelivery}</label> : null}
        </fieldset>
        <button className="btn" disabled={!canSend}>{p.cardOk ? t.pay : t.send}</button>
      </form>
    </div>
  );
}

/**
 * Label der Adresssuche von geo.admin.ch (HTML, z. B. «Bahnhofstrasse 1 <b>9000 St. Gallen</b>») in Felder zerlegen.
 * ASSUMPTION: Aufbau «Strasse Nr <b>PLZ Ort</b>»; passt es nicht, wird der Vorschlag weggelassen (Gast tippt von Hand).
 */
export function parseLabel(html: string): { label: string; street: string; houseNo: string; postalCode: string; city: string } | null {
  const label = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const m = /^(.+?)\s+(\d+[A-Za-z0-9./-]*)\s+(\d{4})\s+(.+)$/.exec(label);
  if (!m) return null;
  return { label, street: m[1], houseNo: m[2], postalCode: m[3], city: m[4] };
}
