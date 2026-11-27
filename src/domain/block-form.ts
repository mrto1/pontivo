import { UserError } from "./errors";
import { LOCALES } from "../i18n/dict";
import { TIME_RE, type BlockType, type L } from "./blocks";
import { decimalToRappen } from "./money";

/**
 * Formularfelder eines Website-Bausteins in Daten umwandeln (reine Logik, ohne I/O).
 * Der Editor (app/admin/[hotelId]/site/[pageId]) schickt je Sprache `feld.de`, `feld.en` …, wiederholte Einträge als `it0.`, `it1.` …
 */

const s = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
export const raw = (f: FormData, k: string) => String(f.get(k) ?? "").replace(/\r\n/g, "\n").trim();
export const l10n = (f: FormData, k: string): L => Object.fromEntries(LOCALES.map((l) => [l, raw(f, `${k}.${l}`) || undefined])) as L;

/** Wiederholte Einträge (it0, it1, …) einlesen, leere weglassen */
function rows(f: FormData, read: (k: string) => unknown): unknown[] {
  const out: unknown[] = [];
  const keys = [...f.keys()];
  for (let i = 0; i < 80; i++) {
    const k = `it${i}`;
    if (!keys.some((x) => x.startsWith(`${k}.`))) continue;
    const v = read(k);
    if (v) out.push(v);
  }
  return out;
}

/** Preis wie «28.50», «28.–», «28,50» → Rappen; leer = kein Preis */
export function priceFrom(v: string): number | null {
  const x = v.replace(/CHF/i, "").replace(/[\s']/g, "").replace(",", ".").replace(/\.?[–-]+$/, "");
  if (!x) return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(x)) throw new UserError(`Preis «${v}» nicht lesbar (z. B. 28.50)`);
  return decimalToRappen(x);
}

/** Öffnungszeiten aus dem Formular: d{tag}.{fenster}.from/to */
export function hoursFrom(f: FormData) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const out: { from: string; to: string }[] = [];
    for (let j = 0; j < 3; j++) {
      const from = s(f, `d${i}.${j}.from`), to = s(f, `d${i}.${j}.to`);
      if (!from && !to) continue;
      if (!TIME_RE.test(from) || !TIME_RE.test(to)) throw new UserError("Öffnungszeiten: bitte bei jedem Zeitfenster Beginn und Ende angeben");
      out.push({ from, to });
    }
    return out.sort((a, b) => a.from.localeCompare(b.from));
  });
  const closures = [];
  for (let i = 0; i < 10; i++) {
    const from = s(f, `c${i}.from`), to = s(f, `c${i}.to`) || from;
    if (from) closures.push({ from, to, label: l10n(f, `c${i}.label`) });
  }
  return { days, closures };
}

const lookFrom = (f: FormData) => ({ align: s(f, "align") || "auto", size: s(f, "size") || "normal" });

/** Formularfelder eines Bausteins in Daten umwandeln */
export function blockFromForm(f: FormData, type: BlockType, id: string, alts: Map<string, string | undefined>): unknown {
  const img = (k: string) => (s(f, k) ? { url: s(f, k), alt: alts.get(s(f, k)) } : null);
  switch (type) {
    case "hero": return { id, type, headline: l10n(f, "headline"), intro: l10n(f, "intro"), image: img("image"), showSearch: f.get("showSearch") === "on" };
    case "text": return { id, type, heading: l10n(f, "heading"), body: l10n(f, "body"), ...lookFrom(f) };
    case "image_text": return { id, type, heading: l10n(f, "heading"), body: l10n(f, "body"), image: img("image"), imageSide: s(f, "imageSide") === "right" ? "right" : "left", ...lookFrom(f) };
    case "gallery": return { id, type, heading: l10n(f, "heading"), images: f.getAll("images").map(String).map((u) => ({ url: u, alt: alts.get(u) })) };
    case "rooms": return { id, type, heading: l10n(f, "heading") };
    case "booking": return { id, type, heading: l10n(f, "heading") };
    case "facts": {
      const items = [];
      for (let i = 0; i < 20; i++) {
        const label = l10n(f, `label${i}`), value = l10n(f, `value${i}`);
        if (label.de || label.en || value.de || value.en) items.push({ label, value });
      }
      return { id, type, heading: l10n(f, "heading"), items };
    }
    case "location": {
      const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s(f, "coords"));
      return { id, type, heading: l10n(f, "heading"), address: s(f, "address"), body: l10n(f, "body"), ...lookFrom(f), lat: m ? Number(m[1]) : null, lng: m ? Number(m[2]) : null };
    }
    case "notice": return { id, type, body: l10n(f, "body"), ...lookFrom(f) };
    case "downloads": return { id, type, heading: l10n(f, "heading"), files: f.getAll("files").map(String) };
    case "reviews": return { id, type, heading: l10n(f, "heading"), moreUrl: s(f, "moreUrl") || null, items: rows(f, (k) => {
      const quote = l10n(f, `${k}.quote`);
      if (!Object.values(quote).some(Boolean)) return null;
      const r = Number(s(f, `${k}.rating`));
      return { quote, author: s(f, `${k}.author`), source: s(f, `${k}.source`), date: s(f, `${k}.date`), rating: r >= 1 && r <= 5 ? r : null, url: s(f, `${k}.url`) || null };
    }) };
    case "labels": return { id, type, heading: l10n(f, "heading"), items: rows(f, (k) => {
      const name = s(f, `${k}.name`);
      if (!name) return null;
      return { name, level: l10n(f, `${k}.level`), text: l10n(f, `${k}.text`), image: img(`${k}.image`), url: s(f, `${k}.url`) || null };
    }) };
    case "faq": return { id, type, heading: l10n(f, "heading"), items: rows(f, (k) => {
      const q = l10n(f, `${k}.q`), a = l10n(f, `${k}.a`);
      return Object.values(q).some(Boolean) ? { q, a } : null;
    }) };
    case "offers": return { id, type, heading: l10n(f, "heading"), items: rows(f, (k) => {
      const title = l10n(f, `${k}.title`);
      if (!Object.values(title).some(Boolean)) return null;
      return { title, text: l10n(f, `${k}.text`), price: l10n(f, `${k}.price`), image: img(`${k}.image`), ratePlanId: s(f, `${k}.plan`) || null, nights: Math.max(1, Number(s(f, `${k}.nights`)) || 1),
        includes: l10n(f, `${k}.includes`), validFrom: s(f, `${k}.validFrom`), validTo: s(f, `${k}.validTo`) };
    }) };
    case "tips": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro"), items: rows(f, (k) => {
      const title = l10n(f, `${k}.title`);
      if (!Object.values(title).some(Boolean)) return null;
      return { title, text: l10n(f, `${k}.text`), distance: l10n(f, `${k}.distance`), image: img(`${k}.image`), category: s(f, `${k}.category`) || "ausflug", season: s(f, `${k}.season`) || "all", url: s(f, `${k}.url`) || null };
    }) };
    case "inquiry": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro"), kinds: f.getAll("kinds").map(String) };
    case "voucher": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro") };
    case "reserve": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro") };
    case "order": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro") };
    case "menu": return { id, type, heading: l10n(f, "heading"), intro: l10n(f, "intro"), note: l10n(f, "note"), source: s(f, "source") === "items" ? "items" : "manual", items: rows(f, (k) => {
      const name = l10n(f, `${k}.name`);
      if (!Object.values(name).some(Boolean)) return null;
      const diet = s(f, `${k}.diet`);
      return { section: l10n(f, `${k}.section`), name, text: l10n(f, `${k}.text`), priceRappen: priceFrom(s(f, `${k}.price`)),
        diet: diet === "vegan" || diet === "vegetarian" ? diet : "", glutenFree: f.get(`${k}.gf`) === "on" };
    }) };
    case "hours": return { id, type, heading: l10n(f, "heading"), place: s(f, "place") || "restaurant", source: s(f, "source") === "opening" ? "opening" : "manual", note: l10n(f, "note"), ...hoursFrom(f) };
  }
}
