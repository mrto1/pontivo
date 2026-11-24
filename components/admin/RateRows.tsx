"use client";
import { useRef, useState } from "react";

type Plan = { id: string; label: string };

// Zeilen werden nur im Browser hinzugefügt oder entfernt, leere Zeilen bleiben nie über einen Reload bestehen.
export default function RateRows({ plans, defaultPlan, from, to, currency, max }: { plans: Plan[]; defaultPlan?: string; from: string; to: string; currency: string; max: number }) {
  const nextKey = useRef(1);
  const [keys, setKeys] = useState<number[]>([0]);
  return (
    <>
      <input type="hidden" name="rows" value={keys.length} />
      <div className="scroll-x">
        <table className="rate-rows">
          <thead>
            <tr>
              <th>Rateplan</th><th>Von</th><th>Bis (inkl.)</th><th>Preis {currency}</th><th>Min. Nächte</th><th>Max. Nächte</th>
              <th>Anreise gesperrt</th><th>Abreise gesperrt</th><th>Verkaufsstopp</th><th aria-label="Zeile entfernen" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k, i) => (
              <tr key={k}>
                <td>
                  <select name={`ratePlanId${i}`} defaultValue={k === 0 ? defaultPlan ?? "" : ""} aria-label={`Rateplan Zeile ${i + 1}`}>
                    <option value="">–</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </td>
                <td><input type="date" name={`from${i}`} defaultValue={from} aria-label="Von" /></td>
                <td><input type="date" name={`to${i}`} defaultValue={to} aria-label="Bis" /></td>
                <td><input name={`price${i}`} inputMode="decimal" placeholder="–" size={7} aria-label="Preis" /></td>
                <td><input name={`minStay${i}`} type="number" min={1} placeholder="–" className="w70" aria-label="Mindestnächte" /></td>
                <td><input name={`maxStay${i}`} type="number" min={0} placeholder="–" title="0 = keine Begrenzung" className="w70" aria-label="Höchstnächte" /></td>
                {["cta", "ctd", "stopSell"].map((n) => (
                  <td key={n}>
                    <select name={`${n}${i}`} defaultValue="" aria-label={n}><option value="">–</option><option value="yes">ja</option><option value="no">nein</option></select>
                  </td>
                ))}
                <td>
                  {keys.length > 1 ? (
                    <button type="button" className="row-x" aria-label={`Zeile ${i + 1} entfernen`} title="Zeile entfernen" onClick={() => setKeys((ks) => ks.filter((x) => x !== k))}>×</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {keys.length < max ? (
        <button type="button" className="link-btn" onClick={() => setKeys((ks) => [...ks, nextKey.current++])}>+ weitere Zeile</button>
      ) : null}
    </>
  );
}
