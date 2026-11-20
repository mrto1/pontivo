import { describe, expect, it } from "vitest";
import { LIMITS, htmlToText, joinPages, parseDraft, pdfPageEstimate, pickLinks, setupImportGate } from "../../src/domain/setup-import";

describe("KI-Einrichtung: Sperre", () => {
  const ok = { billingPaymentMethodId: "pm_1", hostTermsAcceptedAt: new Date() };
  it("erst nach Abo: Karte und Bedingungen, KI muss eingerichtet sein", () => {
    expect(setupImportGate(ok, true)).toEqual({ ok: true });
    expect(setupImportGate({ ...ok, billingPaymentMethodId: null }, true)).toMatchObject({ ok: false });
    expect(setupImportGate({ ...ok, hostTermsAcceptedAt: null }, true)).toMatchObject({ ok: false });
    expect(setupImportGate(ok, false)).toMatchObject({ ok: false });
  });
});

describe("KI-Einrichtung: Text", () => {
  it("HTML wird zu Text ohne Skripte und Stile", () => {
    const t = htmlToText("<html><head><title>x</title></head><body><script>alert(1)</script><style>a{}</style><h1>Zimmer</h1><p>Doppelzimmer &amp; Suite</p><nav>Menü</nav></body></html>");
    expect(t).toBe("Zimmer\nDoppelzimmer & Suite");
  });
  it("Links: nur https, gleiche Domain, passende Stichwörter, keine Dateien, ohne Doppel, begrenzt", () => {
    const html = `<a href="/zimmer">a</a><a href="/zimmer/">b</a><a href="https://fremd.ch/zimmer">c</a><a href="http://www.h.ch/rooms">d</a><a href="/zimmer.pdf">e</a><a href="/faq">f</a><a href="/kontakt-impressum">g</a><a href="/ueber-uns">h</a><a href="/angebote">i</a><a href="/hotel/suiten">j</a>`;
    expect(pickLinks("https://www.h.ch/", html, 3)).toEqual(["https://www.h.ch/zimmer", "https://www.h.ch/faq", "https://www.h.ch/ueber-uns"]);
  });
  it("Gesamttext ist begrenzt", () => {
    const j = joinPages([{ url: "https://a.ch", text: "x".repeat(50_000) }, { url: "https://a.ch/b", text: "y".repeat(50_000) }]);
    expect(j.length).toBeLessThanOrEqual(LIMITS.textChars);
    expect(j).toContain("y");
  });
  it("PDF-Seiten werden geschätzt", () => {
    expect(pdfPageEstimate(Buffer.from("%PDF-1.4 /Type /Pages /Type /Page /Type/Page /Type /Page"))).toBe(3);
  });
});

describe("KI-Einrichtung: Entwurf", () => {
  it("ungültige Einträge fallen weg, der Rest bleibt; Obergrenzen gelten", () => {
    const d = parseDraft(`Hier: {"intro":"Schön.","rooms":[{"name":"Suite","maxAdults":2,"roomCount":2},{"name":"","maxAdults":2},{"name":"Kaputt","maxAdults":99}],"faq":[{"q":"Haustiere?","a":"Ja."},{"q":"x"}]}`);
    expect(d?.rooms.map((r) => r.name)).toEqual(["Suite"]);
    expect(d?.faq).toHaveLength(1);
    const many = parseDraft(JSON.stringify({ rooms: Array.from({ length: 30 }, (_, i) => ({ name: `Z${i}` })) }));
    expect(many?.rooms).toHaveLength(12);
  });
  it("Unbrauchbares ergibt keinen Entwurf", () => {
    expect(parseDraft("kein json")).toBeNull();
    expect(parseDraft('{"rooms":[],"faq":[]}')).toBeNull();
  });
});
