import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  availabilityMessage, availRuns, childBrackets, groupRuns, hotelListFeed, inventoryMessage, inventoryRuns, landingPagesFile, landingTarget, messageId, parseReply,
  propertyDataMessage, rateMessage, rateRuns, rangeDays, refundableDays, taxFeeMessage, taxSeparate, xmlText, type Meta,
} from "../../src/domain/google-hotels";
import type { TaxRule } from "../../src/domain/tourist-tax";

const meta: Meta = { ts: new Date("2026-11-27T10:00:00Z"), id: "rate-abc_1", partner: "pk&1" };
const GL: TaxRule = { adultRappen: 440, reducedRappen: 220, freeUnderAge: 6, reducedUnderAge: 16, status: "verified" };

/** Wohlgeformtes XML (xmllint); ohne xmllint wird übersprungen */
const hasXmllint = (() => { try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const wellFormed = (xml: string) => execFileSync("xmllint", ["--noout", "-"], { input: xml, stdio: ["pipe", "ignore", "pipe"] });

describe("Google Hotelpreise: Nachrichten (SPEC 19.70)", () => {
  it("Hotelliste: Pflichtfelder, Kanton als province, Zeichen maskiert", () => {
    const xml = hotelListFeed([{ id: "h1", name: "Hotel «Rössli» & Co", street: "Seestrasse 1", city: "Luzern", postalCode: "6000", canton: "LU", country: "CH", lat: 47.05, lng: 8.3, phone: "+41410000000", category: "hotel" }]);
    expect(xml).toContain("<id>h1</id>");
    expect(xml).toContain('<component name="addr1">Seestrasse 1</component>');
    expect(xml).toContain('<component name="province">LU</component>');
    expect(xml).toContain("<country>CH</country>");
    expect(xml).toContain("<latitude>47.05</latitude>");
    expect(xml).toContain("Hotel «Rössli» &amp; Co");
    expect(xml).toContain('<phone type="main">+41410000000</phone>');
    if (hasXmllint) wellFormed(xml);
  });

  it("Landingpage-Datei: eine Adresse für alle Betriebe, Platzhalter nach Googles Syntax, & maskiert", () => {
    const xml = landingPagesFile("https://pontivo.ch/");
    expect(xml).toContain('<PointOfSale id="pontivo">');
    expect(xml).toContain("https://pontivo.ch/g/(PARTNER-HOTEL-ID)?checkin=(CHECKINYEAR)-(CHECKINMONTH)-(CHECKINDAY)&amp;checkout=(CHECKOUTYEAR)-(CHECKOUTMONTH)-(CHECKOUTDAY)");
    expect(xml).toContain("adults=(NUM-ADULTS)&amp;children=(NUM-CHILDREN)(FOR-EACH-CHILD-AGE)&amp;age=(CHILD-AGE)(END-FOR-EACH)&amp;lang=(USER-LANGUAGE)");
    expect(xml).not.toMatch(/&(?!amp;)/);
    if (hasXmllint) wellFormed(xml);
  });

  it("Weiterleitung: Reisedaten übernehmen, Ungültiges weglassen, Herkunft immer google", () => {
    const base = "https://pontivo.ch/h/roessli";
    const ok = landingTarget({ base, defaultLang: "de", params: new URLSearchParams("checkin=2026-12-01&checkout=2026-12-04&adults=2&children=2&age=5&age=9&lang=fr") });
    expect(ok).toBe(`${base}/fr/book?checkin=2026-12-01&checkout=2026-12-04&adults=2&children=2&ages=5%2C9&ref=google`);
    // ungültige Daten, unbekannte Sprache
    expect(landingTarget({ base, defaultLang: "it", params: new URLSearchParams("checkin=x&checkout=y&lang=zz") })).toBe(`${base}/it/book?ref=google`);
    // Abreise vor Anreise
    expect(landingTarget({ base, defaultLang: "de", params: new URLSearchParams("checkin=2026-12-04&checkout=2026-12-01") })).toBe(`${base}/de/book?ref=google`);
    // Anzahl ohne Alter
    expect(landingTarget({ base, defaultLang: "de", params: new URLSearchParams("checkin=2026-12-01&checkout=2026-12-02&adults=99&children=1") })).toContain("adults=2&children=1");
  });

  it("Property Data: Zimmer mit Tarifen, Stornofrist aufgerundet", () => {
    expect(refundableDays(null)).toBeNull();
    expect(refundableDays(48)).toBe(2);
    expect(refundableDays(36)).toBe(2);
    expect(refundableDays(24 * 400)).toBe(330);
    const xml = propertyDataMessage(meta, "h1", [{ id: "r1", name: "Doppelzimmer", description: "", photos: [{ url: "https://x.ch/a.jpg", alt: "Zimmer" }], maxOccupancy: 4, maxAdults: 2, maxChildren: 2, planIds: ["p1", "p2"] }],
      [{ id: "p1", name: "Flex", description: "Flex", freeCancelHours: 48, checkinTime: "15:00:00", breakfast: true, dinner: false }, { id: "p2", name: "Fix", description: "Fix", freeCancelHours: null, checkinTime: "15:00", breakfast: false, dinner: false }], "de");
    expect(xml).toContain('partner="pk&amp;1"');
    expect(xml).toContain('<PropertyDataSet action="overlay">');
    expect(xml).toContain("<AllowablePackageIDs><AllowablePackageID>p1</AllowablePackageID><AllowablePackageID>p2</AllowablePackageID></AllowablePackageIDs>");
    expect(xml).toContain('<Refundable available="true" refundable_until_days="2" refundable_until_time="15:00:00"/>');
    expect(xml).toContain('<Refundable available="false"/>');
    expect(xml).toContain("<Capacity>4</Capacity>");
    expect(xml).toContain("<ChildCapacity>2</ChildCapacity>");
    if (hasXmllint) wellFormed(xml);
  });

  it("Bestand und Preise werden zu Bereichen zusammengefasst, Preis je Anzahl Erwachsener wie auf der Buchungsseite", () => {
    const days = rangeDays("2026-12-01", 5);
    expect(groupRuns(days, (d) => (d === "2026-12-03" ? undefined : 1))).toEqual([{ from: "2026-12-01", to: "2026-12-02", value: 1 }, { from: "2026-12-04", to: "2026-12-05", value: 1 }]);
    const inv = inventoryRuns([{ night: "2026-12-01", total: 3, booked: 1, blocked: 0, externalBlocked: 1 }, { night: "2026-12-02", total: 3, booked: 1, blocked: 0, externalBlocked: 1 }, { night: "2026-12-03", total: 3, booked: 3, blocked: 1, externalBlocked: 0 }], true, days);
    expect(inv).toEqual([{ from: "2026-12-01", to: "2026-12-02", value: 1 }, { from: "2026-12-03", to: "2026-12-05", value: 0 }]);
    expect(inventoryRuns([], false, days)).toEqual([{ from: "2026-12-01", to: "2026-12-05", value: 0 }]);
    const plan = { baseOccupancy: 2, extraAdultRappen: 3000, singleDiscountRappen: 2000 };
    const runs = rateRuns([{ night: "2026-12-01", priceRappen: 18000 }, { night: "2026-12-02", priceRappen: 18000 }, { night: "2026-12-03", priceRappen: 20000 }], plan, 3, days);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.value.prices).toEqual([{ guests: 1, rappen: 16000 }, { guests: 2, rappen: 18000 }, { guests: 3, rappen: 21000 }]);
    const xml = rateMessage(meta, "h1", [{ roomId: "r1", planId: "p1", runs }], "CHF", true);
    expect(xml).toContain('NotifType="Overlay"');
    expect(xml).toContain('<StatusApplicationControl Start="2026-12-01" End="2026-12-02" InvTypeCode="r1" RatePlanCode="p1"/>');
    expect(xml).toContain('<BaseByGuestAmt AmountBeforeTax="160.00" CurrencyCode="CHF" NumberOfGuests="1"/>');
    expect(rateMessage(meta, "h1", [{ roomId: "r1", planId: "p1", runs }], "CHF", false)).toContain('AmountAfterTax="180.00"');
    if (hasXmllint) wellFormed(xml);
    const invXml = inventoryMessage(meta, "h1", [{ roomId: "r1", runs: inv }]);
    expect(invXml).toContain('<InvCount Count="1" CountType="2"/>');
    if (hasXmllint) wellFormed(invXml);
  });

  it("Einschränkungen: Stop-Sell, Anreise-/Abreisesperre, Mindest- und Höchstaufenthalt; fester Anreisetag; fehlende Zeile = zu", () => {
    const days = rangeDays("2026-12-07", 3); // Mo, Di, Mi
    const row = (night: string, o: Partial<{ minStayArrival: number; maxStay: number | null; closedToArrival: boolean; closedToDeparture: boolean; stopSell: boolean }> = {}) => ({ night, minStayArrival: 1, maxStay: null, closedToArrival: false, closedToDeparture: false, stopSell: false, ...o });
    const runs = availRuns([row("2026-12-07", { minStayArrival: 2 }), row("2026-12-08", { stopSell: true })], { minNights: 3, arrivalWeekdays: [1], active: true }, days);
    expect(runs[0]!.value).toEqual({ stopSell: false, cta: false, ctd: false, minStay: 3, maxStay: 0 }); // Montag: Anreisetag erlaubt, Tarif-Mindestaufenthalt 3
    expect(runs[1]!.value).toMatchObject({ stopSell: true, cta: true }); // Dienstag: gesperrt und kein Anreisetag
    expect(runs[2]!.value).toMatchObject({ stopSell: true, minStay: 1 }); // Mittwoch: keine Zeile
    const xml = availabilityMessage(meta, "h1", [{ roomId: "r1", planId: "p1", runs }]);
    expect(xml).toContain('<RestrictionStatus Status="Close" Restriction="Master"/>');
    expect(xml).toContain('<RestrictionStatus Status="Open" Restriction="Arrival"/>');
    expect(xml).toContain('<LengthOfStay Time="3" TimeUnit="Day" MinMaxMessageType="SetMinLOS"/>');
    expect(xml).toContain('MinMaxMessageType="SetMaxLOS"');
    if (hasXmllint) wellFormed(xml);
    expect(availRuns([row("2026-12-07")], { minNights: 1, arrivalWeekdays: [], active: false }, [days[0]!])[0]!.value.stopSell).toBe(true);
  });

  it("Kurtaxe: nur wenn sie zum Preis dazukommt; Altersstufen wie in der Buchung; sonst leere Property", () => {
    expect(taxSeparate(GL, false)).toBe(true);
    expect(taxSeparate(GL, true)).toBe(false);
    expect(taxSeparate(null, false)).toBe(false);
    expect(taxSeparate({ ...GL, status: "none" }, false)).toBe(false);
    expect(taxSeparate({ ...GL, adultRappen: 0 }, false)).toBe(false);
    // Glarus: unter 6 frei, unter 16 ermässigt, ab 16 voll
    expect(childBrackets(GL)).toEqual([{ maxAge: 5, rappen: 0 }, { maxAge: 15, rappen: 220 }, { maxAge: 17, rappen: 440 }]);
    expect(childBrackets({ ...GL, freeUnderAge: 0, reducedUnderAge: null, reducedRappen: null })).toEqual([{ maxAge: 17, rappen: 440 }]);
    const xml = taxFeeMessage(meta, "h1", GL, false, "CHF");
    expect(xml).toContain("<Type>amount</Type>");
    expect(xml).toContain("<Basis>person</Basis>");
    expect(xml).toContain("<Period>night</Period>");
    expect(xml).toContain('<AdultCharge amount="4.40"/>');
    expect(xml).toContain('<ChildAgeBracket max_age="5" amount="0.00"/><ChildAgeBracket max_age="15" amount="2.20"/><ChildAgeBracket max_age="17" amount="4.40"/>');
    if (hasXmllint) wellFormed(xml);
    const empty = taxFeeMessage(meta, "h1", GL, true, "CHF");
    expect(empty).not.toContain("<Taxes>");
    expect(empty).toContain("<ID>h1</ID>");
    if (hasXmllint) wellFormed(empty);
  });

  it("Antworten: Erfolg, Fehler, Warnungen, ohne Success", () => {
    expect(parseReply('<OTA_HotelRateAmountNotifRS EchoToken="x"><Success/></OTA_HotelRateAmountNotifRS>')).toEqual({ ok: true, warnings: [], errors: [] });
    expect(parseReply('<RS><Errors><Error Type="12" Code="450" Status="NotProcessed" ShortText="invalid_room"/></Errors></RS>')).toMatchObject({ ok: false, errors: ["invalid_room"] });
    expect(parseReply('<TransactionResponse id="a"><Issues><Issue code="12" status="warning">Hinweis</Issue></Issues><Success/></TransactionResponse>')).toMatchObject({ ok: true, warnings: ["12: Hinweis"] });
    expect(parseReply('<TransactionResponse><Issues><Issue code="7" status="error">kaputt</Issue></Issues></TransactionResponse>')).toMatchObject({ ok: false, errors: ["7: kaputt"] });
    expect(parseReply("<html>502</html>")).toMatchObject({ ok: false, errors: ["Antwort ohne Success"] });
  });

  it("Hilfen: Maskierung und Nachrichten-ID", () => {
    expect(xmlText('a&b<c>"d"')).toBe("a&amp;b&lt;c&gt;&quot;d&quot;");
    expect(messageId("rate-1_a/b c")).toBe("rate-1_ab" + "c");
  });
});
