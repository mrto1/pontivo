"use client";
import { useState } from "react";
import { t, type Locale } from "@/src/i18n/dict";

export function SearchBar({ action, locale, defaults, today, plan }: {
  action: string;
  /** Angebot/Tarif beibehalten (Baustein «Angebote») */
  plan?: string;
  locale: Locale;
  today: string;
  defaults: { checkin?: string; checkout?: string; adults?: number; children?: number; ages?: number[] };
}) {
  const d = t(locale);
  const [children, setChildren] = useState(defaults.children ?? 0);
  return (
    <form className="card searchbar" action={action} method="get">
      {plan ? <input type="hidden" name="plan" value={plan} /> : null}
      <div>
        <label htmlFor="checkin">{d.checkin}</label>
        <input id="checkin" type="date" name="checkin" min={today} defaultValue={defaults.checkin} required />
      </div>
      <div>
        <label htmlFor="checkout">{d.checkout}</label>
        <input id="checkout" type="date" name="checkout" min={today} defaultValue={defaults.checkout} required />
      </div>
      <div>
        <label htmlFor="adults">{d.adults}</label>
        <select id="adults" name="adults" defaultValue={defaults.adults ?? 2}>
          {Array.from({ length: 6 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="children">{d.children}</label>
        <select id="children" name="children" value={children} onChange={(e) => setChildren(Number(e.target.value))}>
          {Array.from({ length: 5 }, (_, i) => i).map((n) => <option key={n}>{n}</option>)}
        </select>
      </div>
      {Array.from({ length: children }, (_, i) => (
        <div key={i}>
          <label htmlFor={`age${i}`}>{d.childAge} {i + 1}</label>
          <select id={`age${i}`} name="age" defaultValue={defaults.ages?.[i] ?? ""} required>
            <option value="" disabled>–</option>
            {Array.from({ length: 18 }, (_, a) => a).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      ))}
      <button className="btn" type="submit">{d.search}</button>
    </form>
  );
}
