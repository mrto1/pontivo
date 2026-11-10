import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { emailOutbox, hotels, inquiries, ratePlans, sitePages, vouchers } from "../../src/db/schema";
import { POST as inquiryPost } from "../../app/api/inquiry/route";
import { POST as voucherPost } from "../../app/api/vouchers/route";
import { createInquiry, listInquiries, setInquiryStatus } from "../../src/services/inquiries";
import { buyVoucher, markVoucherPaid, redeemVoucher, updateVoucherSettings, voucherByToken, VoucherError } from "../../src/services/vouchers";
import { searchOffers } from "../../src/services/search";
import { addBlock, createPage, updateBlock } from "../../src/services/site";
import { updateLanguages } from "../../src/services/brand";
import { setTranslateFetch, translatePage } from "../../src/services/translate";
import { hotelKnowledge } from "../../src/services/knowledge";
import { faqJsonLd, hotelJsonLd, ldJson } from "../../src/lib/structured-data";
import { setPaymentProvider, type PaymentProvider } from "../../src/payments/provider";
import { safeBack } from "../../src/lib/back";
import { blockSchema } from "../../src/domain/blocks";
import { inDays, makeHotel, cardStubs } from "../helpers";

afterAll(closeDb);
afterEach(() => {
  setPaymentProvider(null);
  setTranslateFetch(null);
  delete process.env.ANTHROPIC_API_KEY;
});
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};

describe("Anfragen", () => {
  it("Formular speichert, Mail ans Hotel und an den Gast, Weiterleitung mit Erfolg", async () => {
    const h = await makeHotel();
    const res = await inquiryPost(new Request("http://localhost/api/inquiry", { method: "POST", body: form({
      hotel: h.hotel.slug, lang: "fr", back: "/h/x/fr/seminare", kind: "seminar", name: "Marie Dupont", email: "marie@example.ch", persons: "24", dateFrom: inDays(40), dateTo: inDays(41), message: "Salle pour 24 personnes", page: "seminare",
    }) }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/h/x/fr/seminare#anfrage-gesendet");
    const [q] = await listInquiries(h.hotel.id);
    expect(q).toMatchObject({ kind: "seminar", name: "Marie Dupont", persons: 24, language: "fr", status: "new" });
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.hotelId, h.hotel.id));
    expect(mails.map((m) => [m.template, m.toEmail, m.language]).sort()).toEqual([
      ["inquiry_confirmation", "marie@example.ch", "fr"],
      ["inquiry_received", h.hotel.contactEmail, "de"],
    ]);
    expect(await setInquiryStatus(h.hotel.id, q.id, "done", "t")).toBe(true);
    const other = await makeHotel();
    expect(await setInquiryStatus(other.hotel.id, q.id, "new", "t")).toBe(false); // Mandantentrennung
  });

  it("Spam-Feld und ungültige Angaben → kein Eintrag; Rücksprung nur auf eigene Pfade", async () => {
    const h = await makeHotel();
    const spam = await inquiryPost(new Request("http://localhost/api/inquiry", { method: "POST", body: form({ hotel: h.hotel.slug, back: "/de", kind: "group", name: "x", email: "x@example.ch", website: "http://spam" }) }));
    expect(spam.headers.get("location")).toContain("#anfrage-gesendet");
    const bad = await inquiryPost(new Request("http://localhost/api/inquiry", { method: "POST", body: form({ hotel: h.hotel.slug, back: "/de", kind: "group", name: "x", email: "keine-mail" }) }));
    expect(bad.headers.get("location")).toContain("#anfrage-fehler");
    expect(await listInquiries(h.hotel.id)).toHaveLength(0);
    expect(safeBack("//evil.example/x")).toBe("/");
    expect(safeBack("https://evil.example")).toBe("/");
    expect(safeBack("/h/demo/de/seminare")).toBe("/h/demo/de/seminare");
    await expect(createInquiry(h.hotel, { kind: "wedding", name: "A", email: "a@example.ch", dateFrom: inDays(10), dateTo: inDays(5) })).rejects.toThrow();
  });
});

describe("Gutscheine", () => {
  it("ausgeschaltet → nicht kaufbar", async () => {
    const h = await makeHotel();
    await expect(buyVoucher(h.hotel, { amountRappen: 10000, buyerName: "A", buyerEmail: "a@example.ch" })).rejects.toBeInstanceOf(VoucherError);
  });

  it("kaufen (Fake-Zahlung: sofort bezahlt), Mails, Code, teilweise einlösen, Restwert, Mandantentrennung", async () => {
    const h = await makeHotel();
    await updateVoucherSettings(h.hotel.id, { enabled: true, amounts: [5000, 10000], minRappen: 2000, maxRappen: 50000, validityYears: 3 }, "t");
    const hotel = await fresh(h.hotel.id);
    await expect(buyVoucher(hotel, { amountRappen: 1000, buyerName: "A", buyerEmail: "a@example.ch" })).rejects.toThrow(/amount/);
    const { voucher, checkoutUrl } = await buyVoucher(hotel, { amountRappen: 10000, buyerName: "Peter Muster", buyerEmail: "peter@example.ch", recipientName: "Anna", message: "Alles Gute!", language: "it" });
    expect(checkoutUrl).toContain(`/v/${voucher.publicToken}?paid=1`);
    expect(voucher.code).toMatch(/^GS-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const v = (await voucherByToken(voucher.publicToken))!;
    expect(v).toMatchObject({ status: "paid", amountRappen: 10000, remainingRappen: 10000, platformFeeRappen: 100, language: "it" });
    expect(v.validUntil > inDays(3 * 365 - 2)).toBe(true);
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.hotelId, h.hotel.id));
    expect(mails.map((m) => m.template).sort()).toEqual(["hotel_voucher_sold", "voucher_purchased"]);
    await markVoucherPaid(v.id, { sessionId: null, paymentIntentId: null }); // idempotent
    expect(await db().select().from(emailOutbox).where(eq(emailOutbox.hotelId, h.hotel.id))).toHaveLength(2);

    const after = await redeemVoucher(hotel, v.code.toLowerCase(), 3500, "Abendessen", "user:t");
    expect(after.remainingRappen).toBe(6500);
    await expect(redeemVoucher(hotel, v.code, 7000, "", "t")).rejects.toThrow(/Restwert/);
    const other = await makeHotel();
    await expect(redeemVoucher(other.hotel, v.code, 100, "", "t")).rejects.toThrow(/nicht gefunden/);
    // abgelaufen
    await expect(redeemVoucher(hotel, v.code, 100, "", "t", new Date(Date.now() + 4 * 365 * 864e5))).rejects.toThrow(/abgelaufen/);
  });

  it("Stripe-artige Zahlung: bis zur Bestätigung ausstehend und nicht einlösbar", async () => {
    const pending: PaymentProvider = {
      name: "fake", confirmsImmediately: false, ...cardStubs,
      async createCheckout() { throw new Error("nicht benutzt"); },
      async createPaymentCheckout(a) { expect(a.feeRappen).toBe(200); expect(a.metadata.voucher_id).toBeTruthy(); return { url: "https://checkout.test/x", sessionId: "cs_test" }; },
      async refund() { return { refundId: "re" }; },
    };
    setPaymentProvider(pending);
    const h = await makeHotel();
    await updateVoucherSettings(h.hotel.id, { enabled: true, amounts: [20000], minRappen: 2000, maxRappen: 50000, validityYears: 2 }, "t");
    const res = await voucherPost(new Request("http://localhost/api/vouchers", { method: "POST", body: form({ hotel: h.hotel.slug, back: "/de/gutscheine", amount: "other", other: "200", buyerName: "Eva", buyerEmail: "eva@example.ch", lang: "de" }) }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://checkout.test/x");
    const [v] = await db().select().from(vouchers).where(eq(vouchers.hotelId, h.hotel.id));
    expect(v).toMatchObject({ status: "pending", amountRappen: 20000, stripeSessionId: "cs_test" });
    await expect(redeemVoucher(await fresh(h.hotel.id), v.code, 100, "", "t")).rejects.toThrow(/nicht bezahlt/);
    await markVoucherPaid(v.id, { sessionId: "cs_test", paymentIntentId: "pi_1" });
    expect((await voucherByToken(v.publicToken))!.status).toBe("paid");
  });
});

describe("Angebote und Pakete", () => {
  it("Mindestnächte pro Tarif gelten in der Suche", async () => {
    const h = await makeHotel();
    const rp = h.rooms[0].plans[0];
    await db().update(ratePlans).set({ minNights: 3 }).where(eq(ratePlans.id, rp.id));
    const hotel = await fresh(h.hotel.id);
    const two = await searchOffers(hotel, { checkin: inDays(20), checkout: inDays(22), adults: 2, children: 0 }, { ratePlanId: rp.id });
    expect(two.ok && two.offers).toEqual([]);
    expect(two.ok && two.rejected[0].reason).toBe("min_stay");
    const three = await searchOffers(hotel, { checkin: inDays(20), checkout: inDays(23), adults: 2, children: 0 }, { ratePlanId: rp.id });
    expect(three.ok && three.offers).toHaveLength(1);
  });
});

describe("Bausteine, strukturierte Daten, Übersetzung, Wissen", () => {
  it("neue Bausteine validieren: Gästestimmen brauchen echte Links, FAQ, Tipps, Anfrage", () => {
    expect(blockSchema.parse({ id: "r", type: "reviews", items: [{ quote: { de: "Super" }, author: "Sandra M.", source: "Google", date: "2026-08", rating: 5 }] })).toMatchObject({ type: "reviews" });
    expect(() => blockSchema.parse({ id: "r", type: "reviews", moreUrl: "javascript:alert(1)" })).toThrow();
    expect(() => blockSchema.parse({ id: "r", type: "reviews", items: [{ quote: {}, rating: 6 }] })).toThrow();
    expect(blockSchema.parse({ id: "i", type: "inquiry" })).toMatchObject({ kinds: ["group", "seminar", "wedding"] });
    expect(() => blockSchema.parse({ id: "i", type: "inquiry", kinds: [] })).toThrow();
    expect(blockSchema.parse({ id: "l", type: "location", lat: 47.04, lng: 9.07 })).toMatchObject({ lat: 47.04, lng: 9.07 });
  });

  it("JSON-LD: Hotel mit Adresse, Preisspanne, Koordinaten; FAQ; sicher eingebettet", async () => {
    const h = await makeHotel();
    const p = await createPage(h.hotel.id, "Lage", "t");
    const lid = await addBlock(h.hotel.id, p.id, "location", "t");
    await updateBlock(h.hotel.id, p.id, lid, { id: lid, type: "location", heading: {}, address: "", body: {}, lat: 47.0405, lng: 9.0679 }, "t");
    const fid = await addBlock(h.hotel.id, p.id, "faq", "t");
    await updateBlock(h.hotel.id, p.id, fid, { id: fid, type: "faq", heading: {}, items: [{ q: { de: "Gibt es Parkplätze?" }, a: { de: "Ja, **gratis** vor dem Haus." } }] }, "t");
    const [page] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    const ld = await hotelJsonLd(await fresh(h.hotel.id), "de", "https://hotel.test", [page]);
    expect(ld).toMatchObject({ "@type": "Hotel", name: h.hotel.name, address: { addressCountry: "CH" }, geo: { latitude: 47.0405, longitude: 9.0679 } });
    expect(String(ld.priceRange)).toMatch(/^CHF \d+–\d+$/);
    expect(faqJsonLd(page.blocks, "de")).toMatchObject({ "@type": "FAQPage", mainEntity: [{ name: "Gibt es Parkplätze?", acceptedAnswer: { text: "Ja, gratis vor dem Haus." } }] });
    expect(ldJson({ x: "</script><b>" })).not.toContain("</script>");
  });

  it("Übersetzen erfasst Texte in Listen (FAQ, Tipps, Angebote, Gästestimmen); Wissen für den KI-Chat", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    setTranslateFetch(async (_u, init) => {
      const user: string = JSON.parse(init.body).messages[0].content;
      const texts = JSON.parse(user.slice(user.indexOf("{")));
      const out = { en: Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, `EN ${v}`])) };
      return { status: 200, text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }) };
    });
    const h = await makeHotel();
    await updateLanguages(h.hotel.id, ["en"], "t");
    const p = await createPage(h.hotel.id, "Umgebung", "t");
    const tid = await addBlock(h.hotel.id, p.id, "tips", "t");
    await updateBlock(h.hotel.id, p.id, tid, { id: tid, type: "tips", heading: { de: "Ausflüge" }, intro: {}, items: [{ title: { de: "Klöntalersee" }, text: { de: "Rundweg am See" }, distance: { de: "15 Min. mit dem Auto" }, category: "see", season: "summer" }] }, "t");
    const qid = await addBlock(h.hotel.id, p.id, "faq", "t");
    await updateBlock(h.hotel.id, p.id, qid, { id: qid, type: "faq", heading: {}, items: [{ q: { de: "Hunde erlaubt?" }, a: { de: "Ja, gegen Aufpreis." } }] }, "t");
    await translatePage(await fresh(h.hotel.id), p.id, "missing", "t");
    const [row] = await db().select().from(sitePages).where(eq(sitePages.id, p.id));
    const tips = row.blocks.find((b) => b.id === tid) as any;
    expect(tips.items[0].title.en).toBe("EN Klöntalersee");
    expect(tips.items[0].distance.en).toBe("EN 15 Min. mit dem Auto");
    expect((row.blocks.find((b) => b.id === qid) as any).items[0].a.en).toBe("EN Ja, gegen Aufpreis.");

    const k = await hotelKnowledge(await fresh(h.hotel.id), "en");
    expect(k.tips).toEqual([{ title: "EN Klöntalersee", text: "EN Rundweg am See", category: "see", season: "summer", distance: "EN 15 Min. mit dem Auto", url: null }]);
    expect(k.faq).toEqual([{ q: "EN Hunde erlaubt?", a: "EN Ja, gegen Aufpreis." }]);
    expect(k.rooms[0].plans.length).toBeGreaterThan(0);
  });
});
