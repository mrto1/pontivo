import { describe, expect, it } from "vitest";
import { parseInline, parseRich, plainText, safeHref } from "../../src/domain/richtext";
import { fontOf, layoutOf, FONTS, LAYOUTS } from "../../src/domain/theme";
import { isPdf } from "../../src/lib/storage";
import { blockSchema, lookClass } from "../../src/domain/blocks";

describe("Textformatierung", () => {
  it("fett, kursiv, unterstrichen, Hausfarbe, verschachtelt", () => {
    expect(parseInline("ein **fettes** und *kursives* __Wort__ ==neu==")).toEqual([
      { t: "text", v: "ein " },
      { t: "b", c: [{ t: "text", v: "fettes" }] },
      { t: "text", v: " und " },
      { t: "i", c: [{ t: "text", v: "kursives" }] },
      { t: "text", v: " " },
      { t: "u", c: [{ t: "text", v: "Wort" }] },
      { t: "text", v: " " },
      { t: "mark", c: [{ t: "text", v: "neu" }] },
    ]);
    expect(parseInline("**sehr *wichtig***")[0]).toEqual({ t: "b", c: [{ t: "text", v: "sehr " }, { t: "i", c: [{ t: "text", v: "wichtig" }] }] });
  });

  it("offene Zeichen bleiben Text", () => {
    expect(parseInline("5 * 3 = 15 und **offen")).toEqual([{ t: "text", v: "5 * 3 = 15 und **offen" }]);
  });

  it("Links nur mit sicheren Zielen", () => {
    expect(parseInline("[Wandern](https://www.glarnerland.ch)")).toEqual([{ t: "a", href: "https://www.glarnerland.ch", c: [{ t: "text", v: "Wandern" }] }]);
    expect(parseInline("[Restaurant](/restaurant)")[0]).toMatchObject({ t: "a", href: "/restaurant" });
    expect(parseInline("[x](javascript:alert(1))").every((x) => x.t === "text")).toBe(true);
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });

  it("E-Mail, Telefon und Webadressen werden klickbar", () => {
    const xs = parseInline("Mail info@hotel.ch, Tel. +41 55 640 11 22 oder 055 640 11 22, siehe www.glarnerland.ch.");
    const links = xs.filter((x) => x.t === "a").map((x) => (x as { href: string }).href);
    expect(links).toEqual(["mailto:info@hotel.ch", "tel:+41556401122", "tel:0556401122", "https://www.glarnerland.ch"]);
    // Linktext wird nicht nochmals verlinkt
    const nested = parseInline("[www.hotel.ch](https://www.hotel.ch)");
    expect(nested).toEqual([{ t: "a", href: "https://www.hotel.ch", c: [{ t: "text", v: "www.hotel.ch" }] }]);
  });

  it("Absätze, Zwischentitel, Aufzählung, nummerierte Liste", () => {
    const b = parseRich("Willkommen\nim Tal\n\n## Inbegriffen\n- Frühstück\n- WLAN\n\n1. Anreise\n2. Geniessen");
    expect(b.map((x) => x.kind)).toEqual(["p", "h", "ul", "ol"]);
    expect(b[0]).toMatchObject({ kind: "p", lines: [[{ t: "text", v: "Willkommen" }], [{ t: "text", v: "im Tal" }]] });
    expect(b[2]).toMatchObject({ kind: "ul", items: [[{ v: "Frühstück" }], [{ v: "WLAN" }]] });
    expect(plainText("**Hallo** im [Tal](/tal)\n- a\n- b")).toBe("Hallo im Tal a, b");
  });
});

describe("Gestaltung", () => {
  it("8 Layouts und 8 Schriftpaare, unbekannte Werte → Standard", () => {
    expect(LAYOUTS).toHaveLength(8);
    expect(FONTS).toHaveLength(8);
    expect(layoutOf("redaktion")).toBe("redaktion");
    expect(fontOf("boutique")).toBe("boutique");
    expect(layoutOf(undefined)).toBe("klassisch");
    expect(layoutOf("panorama")).toBe("panorama");
    expect(layoutOf("<script>")).toBe("klassisch");
    expect(fontOf("elegant")).toBe("elegant");
    expect(fontOf("comic-sans")).toBe("klassisch");
  });

  it("Ausrichtung/Grösse: Standard folgt dem Layout", () => {
    const b = blockSchema.parse({ id: "x", type: "text" });
    expect(b).toMatchObject({ align: "auto", size: "normal" });
    expect(lookClass(b as never)).toBe("");
    expect(lookClass({ align: "center", size: "large" })).toBe("t-center t-large");
    expect(() => blockSchema.parse({ id: "x", type: "text", align: "justify" })).toThrow();
  });

  it("PDF-Erkennung an den Bytes", () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.7\n…"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
  });

  it("Downloads-Baustein nur mit PDFs aus der Bibliothek", () => {
    const ok = `/media/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/abcdefghijklmnop.pdf`;
    expect(blockSchema.parse({ id: "d", type: "downloads", files: [ok] })).toMatchObject({ files: [ok] });
    expect(() => blockSchema.parse({ id: "d", type: "downloads", files: ["https://evil.example/x.pdf"] })).toThrow();
  });
});
