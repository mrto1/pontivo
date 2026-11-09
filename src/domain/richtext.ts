/**
 * Einfache Textformatierung für die Hotel-Website. Gespeichert wird reiner Text mit wenigen Zeichen,
 * dargestellt wird ohne HTML (kein dangerouslySetInnerHTML), damit kein Text das Layout oder die Sicherheit gefährdet.
 *
 *   **fett**   *kursiv*   __unterstrichen__   ==farbig (Hausfarbe)==   [Linktext](https://…)
 *   Zeile mit "- "  → Aufzählung        Zeile mit "1. " → nummerierte Liste
 *   Zeile mit "## " → Zwischentitel     Leerzeile       → neuer Absatz
 *   E-Mail-Adressen, Telefonnummern und Webadressen werden automatisch zu Links.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b" | "i" | "u" | "mark"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] };

export type RichBlock =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "h"; c: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] };

/** Nur sichere Ziele: http(s), mailto, tel oder ein Pfad auf derselben Website */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(h)) return h;
  if (/^\/(?!\/)/.test(h)) return h;
  return null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// Schweizer und internationale Nummern: +41 55 640 11 22, 055 640 11 22, +41556401122
const PHONE = /(?:\+\d{2,3}\s?|\b0)\d{2}\s?\d{3}\s?\d{2}\s?\d{2}\b/;
// Webadressen: https://… oder www.… (Satzzeichen am Ende gehören nicht dazu)
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"»]/;
const AUTO = new RegExp(`(${EMAIL.source})|(${PHONE.source})|(${URL_RE.source})`, "g");

function autolink(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(AUTO)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: "text", v: s.slice(last, i) });
    const v = m[0];
    const href = m[1] ? `mailto:${v}` : m[2] ? `tel:${v.replace(/\s/g, "")}` : /^https?:/i.test(v) ? v : `https://${v}`;
    out.push({ t: "a", href, c: [{ t: "text", v }] });
    last = i + v.length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

export function parseInline(s: string, depth = 0, auto = true): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(...(auto ? autolink(buf) : [{ t: "text" as const, v: buf }]));
    buf = "";
  };
  const wrap = (marker: string, t: "b" | "i" | "u" | "mark", i: number): number | null => {
    if (depth > 4) return null;
    const from = i + marker.length;
    // Wie Markdown: Zeichen müssen am Wort anliegen ("5 * 3" ist keine Formatierung)
    if (from >= s.length || /\s/.test(s[from])) return null;
    let j = s.indexOf(marker, from);
    while (j !== -1 && /\s/.test(s[j - 1])) j = s.indexOf(marker, j + 1);
    if (j === -1 || j <= from) return null;
    // "**fett *kursiv***": schliessendes ** am Ende einer Sternfolge
    if (marker === "**") while (s[j + 2] === "*") j++;
    flush();
    out.push({ t, c: parseInline(s.slice(i + marker.length, j), depth + 1, auto) });
    return j + marker.length;
  };
  let i = 0;
  while (i < s.length) {
    let next: number | null = null;
    if (s.startsWith("**", i)) next = wrap("**", "b", i);
    else if (s.startsWith("==", i)) next = wrap("==", "mark", i);
    else if (s.startsWith("__", i)) next = wrap("__", "u", i);
    else if (s[i] === "*") next = wrap("*", "i", i);
    else if (s[i] === "[") {
      const m = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/.exec(s.slice(i));
      const href = m ? safeHref(m[2]) : null;
      if (m && href && depth <= 4) {
        flush();
        out.push({ t: "a", href, c: parseInline(m[1], depth + 1, false) });
        next = i + m[0].length;
      }
    }
    if (next === null) {
      buf += s[i];
      i++;
    } else i = next;
  }
  flush();
  return out;
}

export function parseRich(text: string): RichBlock[] {
  const out: RichBlock[] = [];
  let para: Inline[][] = [];
  const endPara = () => {
    if (para.length) out.push({ kind: "p", lines: para });
    para = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const ul = /^\s*[-•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    const h = /^\s*#{2,3}\s+(.*)$/.exec(line);
    if (!line.trim()) endPara();
    else if (h) {
      endPara();
      out.push({ kind: "h", c: parseInline(h[1]) });
    } else if (ul || ol) {
      endPara();
      const kind = ul ? "ul" : "ol";
      const prev = out[out.length - 1];
      const item = parseInline((ul ?? ol)![1]);
      if (prev && prev.kind === kind) prev.items.push(item);
      else out.push({ kind, items: [item] });
    } else para.push(parseInline(line));
  }
  endPara();
  return out;
}

/** Text ohne Formatierungszeichen (z. B. für Google-Beschreibungen) */
export function plainText(text: string): string {
  const flat = (xs: Inline[]): string => xs.map((x) => (x.t === "text" ? x.v : flat(x.c))).join("");
  return parseRich(text)
    .map((b) => (b.kind === "p" ? b.lines.map(flat).join(" ") : b.kind === "h" ? flat(b.c) : b.items.map(flat).join(", ")))
    .join(" ");
}
