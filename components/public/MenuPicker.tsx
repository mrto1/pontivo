import { formatChf } from "@/src/domain/money";
import { PRE } from "@/src/i18n/preorder";
import { ORD } from "@/src/i18n/order";
import { ALLERGEN_LABEL, type Allergen } from "@/src/domain/online-order";
import type { Locale } from "@/src/i18n/dict";
import type { onlineMenu } from "@/src/services/online-orders";
import { VariantGuard } from "./VariantGuard";

type Item = Awaited<ReturnType<typeof onlineMenu>>[number];
/** Varianten je Artikel mit Optionen (z. B. zwei Steaks in verschiedenen Garstufen) */
const VARIANTS = 3;

/**
 * Speisekarte zum Auswählen (Vorbestellung, Bestellen am Tisch): Mengen, Optionen (Garstufe …) und Sonderwunsch; Feldnamen siehe `parseCartForm`.
 * Pflicht-Optionen sind nicht vorausgewählt: Der Gast wählt bewusst, sonst meldet der Server die fehlende Wahl.
 */
export function MenuPicker({ menu, locale = "de" }: { menu: Awaited<ReturnType<typeof onlineMenu>>; locale?: Locale }) {
  const pre = PRE[locale];
  const ord = ORD[locale];
  const cats = [...new Set(menu.map((x) => x.category))];
  const info = (x: Item) => (
    <>
      {x.description ? <p className="small muted m0">{x.description}</p> : null}
      {x.allergens.length ? <p className="small muted m0">{ord.allergens}: {x.allergens.map((a) => ALLERGEN_LABEL[a as Allergen]?.[locale] ?? a).join(", ")}</p> : null}
    </>
  );
  const variant = (x: Item, k: number) => (
    <fieldset key={k} className="stack small menu-variant">
      <legend>{pre.variant(k + 1)}</legend>
      <VariantGuard />
      <div className="tq-line"><label htmlFor={`p_${x.id}.${k}`}>{pre.qty}</label><input id={`p_${x.id}.${k}`} name={`p_${x.id}.${k}`} type="number" inputMode="numeric" min={0} max={50} defaultValue={0} aria-label={`${x.name} ${k + 1}: ${pre.qty}`} /></div>
      {x.groups.map((g) => (
        <div key={g.id}>
          {g.maxChoices === 1 ? (
            <>
              <label htmlFor={`o_${x.id}.${k}.${g.id}`}>{g.name}{g.required ? ` (${ord.required})` : ""}</label>
              <select id={`o_${x.id}.${k}.${g.id}`} name={`o_${x.id}.${k}.${g.id}`} aria-label={`${x.name} ${k + 1}: ${g.name}`} defaultValue="" data-required={g.required ? "" : undefined}>
                <option value="">{g.required ? pre.choose : "–"}</option>
                {g.options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.priceRappen ? ` (+${formatChf(o.priceRappen)})` : ""}</option>)}
              </select>
            </>
          ) : (
            <fieldset className="plain"><legend>{g.name}{g.required ? ` (${ord.required})` : ""}</legend>
              {g.options.map((o) => <label key={o.id} className="check"><input type="checkbox" name={`o_${x.id}.${k}.${g.id}`} value={o.id} />{o.name}{o.priceRappen ? ` (+${formatChf(o.priceRappen)})` : ""}</label>)}
            </fieldset>
          )}
        </div>
      ))}
      <div><label htmlFor={`n_${x.id}.${k}`}>{pre.note}</label><input id={`n_${x.id}.${k}`} name={`n_${x.id}.${k}`} maxLength={120} /></div>
    </fieldset>
  );
  return (
    <>
      {cats.map((c) => (
        <div key={c} className="stack"><strong className="small">{c}</strong>
          {menu.filter((x) => x.category === c).map((x) => x.groups.length === 0 ? (
            <div key={x.id} className="stack menu-pick">
              <div className="tq-line"><label htmlFor={`p_${x.id}`}>{x.name}</label><span className="small muted">{formatChf(x.priceRappen)}</span><input id={`p_${x.id}`} name={`p_${x.id}`} type="number" inputMode="numeric" min={0} max={50} defaultValue={0} aria-label={`${pre.qty}: ${x.name}`} /></div>
              {info(x)}
            </div>
          ) : (
            <details key={x.id} className="stack menu-pick" data-testid={`pre-opt-${x.id}`}>
              <summary>{x.name} <span className="small muted">{formatChf(x.priceRappen)}</span></summary>
              {info(x)}
              {variant(x, 0)}
              <details className="menu-more">
                <summary className="small">{pre.moreVariants}</summary>
                {Array.from({ length: VARIANTS - 1 }, (_, i) => variant(x, i + 1))}
              </details>
            </details>
          ))}
        </div>
      ))}
    </>
  );
}
