import { formatChf } from "@/src/domain/money";
import { PRE } from "@/src/i18n/preorder";
import type { Locale } from "@/src/i18n/dict";
import type { onlineMenu } from "@/src/services/online-orders";

/** Speisekarte mit Mengen, Optionen (Garstufe …) und Sonderwunsch; Feldnamen siehe `parseCartForm` */
export function MenuPicker({ menu, locale = "de" }: { menu: Awaited<ReturnType<typeof onlineMenu>>; locale?: Locale }) {
  const pre = PRE[locale];
  const cats = [...new Set(menu.map((x) => x.category))];
  return (
    <>
      {cats.map((c) => (
        <div key={c} className="stack"><strong className="small">{c}</strong>
          {menu.filter((x) => x.category === c).map((x) => x.groups.length === 0 ? (
            <div key={x.id} className="tq-line"><label htmlFor={`p_${x.id}`}>{x.name}</label><span className="small muted">{formatChf(x.priceRappen)}</span><input id={`p_${x.id}`} name={`p_${x.id}`} type="number" min={0} max={50} defaultValue={0} aria-label={`${pre.qty}: ${x.name}`} /></div>
          ) : (
            <details key={x.id} className="stack" data-testid={`pre-opt-${x.id}`}>
              <summary>{x.name} <span className="small muted">{formatChf(x.priceRappen)}</span></summary>
              {[0, 1, 2].map((k) => (
                <div key={k} className="stack small">
                  <div className="tq-line"><label htmlFor={`p_${x.id}.${k}`}>{pre.qty} {k + 1}</label><input id={`p_${x.id}.${k}`} name={`p_${x.id}.${k}`} type="number" min={0} max={50} defaultValue={0} /></div>
                  {x.groups.map((g) => (
                    <div key={g.id}><span>{g.name}{g.required ? " *" : ""}</span>{" "}
                      {g.maxChoices === 1 ? (
                        <select name={`o_${x.id}.${k}.${g.id}`} aria-label={`${x.name} ${k + 1}: ${g.name}`} defaultValue={g.required ? g.options[0]?.id : ""}>
                          {g.required ? null : <option value="">–</option>}
                          {g.options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.priceRappen ? ` (+${formatChf(o.priceRappen)})` : ""}</option>)}
                        </select>
                      ) : g.options.map((o) => <label key={o.id}><input type="checkbox" name={`o_${x.id}.${k}.${g.id}`} value={o.id} /> {o.name}{o.priceRappen ? ` (+${formatChf(o.priceRappen)})` : ""}</label>)}
                    </div>
                  ))}
                  <input name={`n_${x.id}.${k}`} maxLength={120} placeholder={pre.note} aria-label={`${x.name} ${k + 1}: ${pre.note}`} />
                </div>
              ))}
            </details>
          ))}
        </div>
      ))}
    </>
  );
}
