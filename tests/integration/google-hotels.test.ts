import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { extras, googleAriState, hotels, inventoryDays, ratesDays, sitePages } from "../../src/db/schema";
import { parseReply, type GoogleKind } from "../../src/domain/google-hotels";
import { GoogleError, googleSettings, setHotelLinksStatus } from "../../src/services/google";
import { buildSnapshot, googleHotelsJob, hotelListXml, landingPagesXml, listingEligibility, partnerOverview, previewMessages, setPartner, syncHotel, type Sender } from "../../src/services/google-hotels";
import { GET as landing } from "../../app/g/[hotelId]/route";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const reload = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0]!;

/** Betrieb in Glarus (Kurtaxe-Regel bestätigt) mit Adresse und Lage, bereit für Google */
async function ready() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 2, maxAdults: 2, maxChildren: 2, maxOccupancy: 4, basePriceRappen: 18000 }]);
  await db().update(hotels).set({ addressLine: "Marktplatz 1", postalCode: "8750", city: "Glarus", contactPhone: "055 640 10 10" }).where(eq(hotels.id, h.hotel.id));
  await db().insert(sitePages).values({ hotelId: h.hotel.id, slug: "", title: { de: "Start" }, blocks: [{ id: "l", type: "location", heading: {}, address: "", body: {}, lat: 47.04, lng: 9.07 }] as never });
  return { ...h, hotel: await reload(h.hotel.id) };
}

/** Sender, der alles aufzeichnet und mit Erfolg antwortet (oder mit dem gewünschten Fehler) */
function recorder(fail: (k: GoogleKind) => boolean = () => false) {
  const sent: { kind: GoogleKind; xml: string }[] = [];
  const send: Sender = async (kind, xml) => {
    sent.push({ kind, xml });
    return fail(kind) ? parseReply('<RS><Errors><Error ShortText="unknown_room"/></Errors></RS>') : parseReply("<RS><Success/></RS>");
  };
  return { sent, send };
}

describe("Google Hotelpreise: Partner-Anbindung (SPEC 19.70)", () => {
  it("Voraussetzungen: ohne Lage nicht zugelassen; der Channex-Kanal blockiert; Aufnahme nur wenn erfüllt", async () => {
    const h = await makeHotel({}, [{ name: "DZ", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
    await db().update(hotels).set({ addressLine: "Marktplatz 1", postalCode: "8750", city: "Glarus" }).where(eq(hotels.id, h.hotel.id));
    let e = await listingEligibility(await reload(h.hotel.id));
    expect(e.ok).toBe(false);
    expect(e.missing.join()).toMatch(/Lage auf der Karte/);
    await expect(setPartner(await reload(h.hotel.id), true, "t")).rejects.toThrow(GoogleError);

    const r = await ready();
    e = await listingEligibility(r.hotel);
    expect(e).toMatchObject({ ok: true, missing: [] });
    expect(e.entry).toMatchObject({ id: r.hotel.id, canton: "GL", lat: 47.04, lng: 9.07, phone: "+41556401010", country: "CH" });

    // Pflicht-Zusatzleistungen blockieren nicht mehr, sie gehen als Gebühr an Google
    await db().insert(extras).values({ hotelId: r.hotel.id, name: { de: "Endreinigung" }, priceRappen: 5000, unit: "per_booking", mandatory: true });
    expect((await listingEligibility(r.hotel)).ok).toBe(true);

    await setHotelLinksStatus(r.hotel.id, "active", "t");
    expect((await listingEligibility(r.hotel)).missing.join()).toMatch(/Channex/);
    await setHotelLinksStatus(r.hotel.id, "off", "t");

    await setPartner(r.hotel, true, "t");
    expect((await googleSettings(r.hotel.id)).partner).toBe(true);
    const ov = (await partnerOverview()).find((p) => p.hotelId === r.hotel.id);
    expect(ov).toMatchObject({ partner: true, missing: [] });
    await setPartner(r.hotel, false, "t");
    expect((await googleSettings(r.hotel.id)).partner).toBe(false);
  });

  it("Pflicht-Zusatzleistungen gehen als Gebühr an Google, Preise «vor Steuern»", async () => {
    const r = await ready();
    const rt = r.rooms[0]!.roomType.id;
    await db().insert(extras).values([
      { hotelId: r.hotel.id, name: { de: "Endreinigung" }, priceRappen: 5000, unit: "per_booking", mandatory: true },
      { hotelId: r.hotel.id, name: { de: "Bettwäsche" }, priceRappen: 800, unit: "per_person_night", mandatory: true, roomTypeIds: [rt] },
      { hotelId: r.hotel.id, name: { de: "Frühstück" }, priceRappen: 2000, unit: "per_person_night", mandatory: false },
    ]);
    const snap = await buildSnapshot(r.hotel);
    expect(snap.taxes.fees).toHaveLength(2);
    expect(snap.separate).toBe(true);
    const xml = (await previewMessages(r.hotel)).find((m) => m.kind === "taxes")!.xml;
    expect(xml).toContain("<Fees>");
    expect(xml).toContain("<Amount>50.00</Amount>");
    expect(xml).toContain("<Amount>8.00</Amount>");
    expect(xml).not.toContain("20.00");
    expect(xml).toContain(`<RoomType id="${rt}"/>`);
  });

  it("Hotelliste enthält nur Betriebe im Feed; Landingpage-Datei zeigt auf die Plattform", async () => {
    const r = await ready();
    expect((await hotelListXml()).xml).not.toContain(r.hotel.id);
    await setPartner(r.hotel, true, "t");
    const list = await hotelListXml();
    expect(list.xml).toContain(`<id>${r.hotel.id}</id>`);
    expect(list.xml).toContain("<latitude>47.04</latitude>");
    expect(landingPagesXml()).toContain("/g/(PARTNER-HOTEL-ID)?");
  });

  it("Stand: Zimmer, Preise je Belegung, Bestand, Kurtaxe aus der Datenbank", async () => {
    const r = await ready();
    const snap = await buildSnapshot(r.hotel);
    expect(snap.separate).toBe(true); // Glarus: Kurtaxe kommt zum Preis dazu
    expect(snap.property.rooms).toHaveLength(1);
    expect(snap.property.rooms[0]!.planIds.sort()).toEqual(r.rooms[0]!.plans.map((p) => p.id).sort());
    expect(snap.rate).toHaveLength(r.rooms[0]!.plans.length);
    expect(snap.availability).toHaveLength(r.rooms[0]!.plans.length);
    expect(snap.inventory).toHaveLength(1);
    expect(snap.inventory[0]!.value[0]!.value).toBe(2);
    const price = snap.rate[0]!.value[0]!.value.prices;
    expect(price.map((p) => p.guests)).toEqual([1, 2]);
    expect(price[1]!.rappen).toBeGreaterThanOrEqual(18000);
    expect(snap.taxes.rule?.adultRappen).toBe(440);
  });

  it("Abgleich: erst alles, dann nur Änderungen; Fehler speichern nichts und lösen Wiederholung aus", async () => {
    const r = await ready();
    await setPartner(r.hotel, true, "t");
    const hotel = await reload(r.hotel.id);

    // Trockenlauf: zählt, sendet und speichert nichts
    const dry = await syncHotel(hotel, null);
    expect(dry).toMatchObject({ dryRun: true, failed: null });
    expect(dry.sent.property).toBe(1);
    expect(await db().select().from(googleAriState).where(eq(googleAriState.hotelId, hotel.id))).toHaveLength(0);

    const a = recorder();
    const first = await syncHotel(hotel, a.send);
    expect(first.failed).toBeNull();
    expect(a.sent.map((s) => s.kind)).toEqual(["property", "taxes", "inventory", "rate", "availability"]);
    expect(a.sent[0]!.xml).toContain(`<Property>${hotel.id}</Property>`);
    expect(a.sent[3]!.xml).toContain(`HotelCode="${hotel.id}"`);
    expect(a.sent[3]!.xml).toContain("AmountBeforeTax");
    expect(a.sent[1]!.xml).toContain('<AdultCharge amount="4.40"/>');

    // nichts geändert → nichts gesendet
    const b = recorder();
    await syncHotel(hotel, b.send);
    expect(b.sent).toHaveLength(0);

    // eine Buchung → nur der Bestand geht nochmals raus
    const night = inDays(3);
    await db().update(inventoryDays).set({ booked: 1 }).where(and(eq(inventoryDays.roomTypeId, r.rooms[0]!.roomType.id), eq(inventoryDays.night, night)));
    const c = recorder();
    await syncHotel(hotel, c.send);
    expect(c.sent.map((s) => s.kind)).toEqual(["inventory"]);
    expect(c.sent[0]!.xml).toContain(`Start="${night}" End="${night}"`);
    expect(c.sent[0]!.xml).toContain('<InvCount Count="1" CountType="2"/>');

    // Preis- und Sperränderung → Preise und Einschränkungen
    await db().update(ratesDays).set({ priceRappen: 25000, stopSell: true }).where(and(eq(ratesDays.ratePlanId, r.rooms[0]!.plans[0]!.id), eq(ratesDays.night, inDays(5))));
    const d = recorder();
    await syncHotel(hotel, d.send);
    expect(d.sent.map((s) => s.kind)).toEqual(["rate", "availability"]);
    expect(d.sent[0]!.xml).toContain('AmountBeforeTax="250.00"');
    expect(d.sent[1]!.xml).toContain('Status="Close" Restriction="Master"');

    // Google lehnt ab → Stand bleibt, Fehler wird gemerkt, nächster Durchlauf sendet erneut
    await db().update(inventoryDays).set({ booked: 2 }).where(and(eq(inventoryDays.roomTypeId, r.rooms[0]!.roomType.id), eq(inventoryDays.night, night)));
    const f = recorder((k) => k === "inventory");
    const bad = await syncHotel(hotel, f.send);
    expect(bad.failed).toMatch(/unknown_room/);
    const [st] = await db().select().from(googleAriState).where(and(eq(googleAriState.hotelId, hotel.id), eq(googleAriState.kind, "inventory")));
    expect(st!.lastError).toMatch(/unknown_room/);
    expect(st!.failedAt).not.toBeNull();
    expect((await partnerOverview()).find((p) => p.hotelId === hotel.id)?.lastError).toMatch(/unknown_room/);
    const g = recorder();
    await syncHotel(hotel, g.send);
    expect(g.sent.map((s) => s.kind)).toEqual(["inventory"]);
    expect((await db().select().from(googleAriState).where(and(eq(googleAriState.hotelId, hotel.id), eq(googleAriState.kind, "inventory"))))[0]!.failedAt).toBeNull();

    // Kurtaxe im Preis enthalten → Preise «nach Steuern», Kurtaxe-Meldung leer
    await db().update(hotels).set({ touristTaxIncludedInPrice: true }).where(eq(hotels.id, hotel.id));
    const h2 = recorder();
    await syncHotel(await reload(hotel.id), h2.send);
    expect(h2.sent.map((s) => s.kind)).toEqual(["taxes", "rate"]);
    expect(h2.sent[0]!.xml).not.toContain("<Taxes>");
    expect(h2.sent[1]!.xml).toContain("AmountAfterTax");
  });

  it("Zimmer deaktiviert → Zimmer verschwindet aus den Zimmerdaten; nicht zugelassene Betriebe werden nicht gesendet", async () => {
    const r = await ready();
    await setPartner(r.hotel, true, "t");
    await db().update(hotels).set({ status: "paused" }).where(eq(hotels.id, r.hotel.id));
    const a = recorder();
    const res = await syncHotel(await reload(r.hotel.id), a.send);
    expect(res.failed).toMatch(/nicht zugelassen/);
    expect(a.sent).toHaveLength(0);
  });

  it("Vorschau liefert alle Nachrichten; der Job ohne Partner-Schlüssel tut nichts", async () => {
    const r = await ready();
    const msgs = await previewMessages(r.hotel);
    expect(msgs.map((m) => m.kind)).toEqual(["property", "taxes", "inventory", "rate", "availability"]);
    expect(await googleHotelsJob(new Date(), null)).toBe(0);
  });

  it("Landingpage /g/<Hotel-ID>: leitet sofort auf die Buchungsseite mit Reisedaten und Herkunft weiter", async () => {
    const r = await ready();
    const call = (id: string, qs: string) => landing(new Request(`http://localhost/g/${id}?${qs}`), { params: Promise.resolve({ hotelId: id }) });
    const res = await call(r.hotel.id, "checkin=2026-12-01&checkout=2026-12-03&adults=2&children=1&age=7&lang=en");
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("/en/book?checkin=2026-12-01&checkout=2026-12-03&adults=2&children=1&ages=7&ref=google");
    expect((await call("nicht-gueltig", "")).status).toBe(404);
    expect((await call("00000000-0000-0000-0000-000000000000", "")).status).toBe(404);
    await db().update(hotels).set({ status: "paused" }).where(eq(hotels.id, r.hotel.id));
    expect((await call(r.hotel.id, "")).status).toBe(404);
  });
});
