import { describe, expect, it } from "vitest";
import { groupPushes, type PushRowLite } from "../../src/domain/push-group";

const row = (id: number, dedupeKey: string, kind: PushRowLite["kind"], hotelId = "h1", extra: Partial<PushRowLite> = {}): PushRowLite =>
  ({ id, hotelId, dedupeKey, kind, title: `T${id}`, body: `B${id}`, url: `/admin/${hotelId}/x`, attempts: 0, ...extra });

describe("Mitteilungen zusammenfassen (SPEC 20.1)", () => {
  it("gleichartige neue Ereignisse eines Betriebs werden eine Sammelmeldung mit Link auf die Liste", () => {
    const u = groupPushes([row(1, "order:a", "orders"), row(2, "order:b", "orders"), row(3, "order:c", "orders")]);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ ids: [1, 2, 3], title: "3 neue Bestellungen", url: "/admin/h1/restaurant/bestellungen", tag: "group:h1:orders" });
  });

  it("eine einzelne Meldung bleibt unverändert; zwei Betriebe und zwei Arten werden getrennt", () => {
    const u = groupPushes([row(1, "order:a", "orders"), row(2, "order:b", "orders", "h2"), row(3, "reservation:a", "reservations"), row(4, "reservation:b", "reservations")]);
    expect(u.map((x) => [x.ids, x.title])).toEqual([[[1], "T1"], [[2], "T2"], [[3, 4], "2 neue Reservationen"]]);
  });

  it("Dringendes bleibt einzeln: Erinnerung «wartet», Überbuchung, Storno, Sonstiges", () => {
    const u = groupPushes([row(1, "order-alarm:a", "orders"), row(2, "order-alarm:b", "orders"), row(3, "booking_overbooking:x", "bookings"), row(4, "booking_cancelled:y", "bookings"), row(5, "voucher:z", "other"), row(6, "voucher:w", "other")]);
    expect(u.map((x) => x.ids)).toEqual([[1], [2], [3], [4], [5], [6]]);
  });

  it("Reihenfolge nach der ersten Meldung; Versuche: der höchste zählt", () => {
    const u = groupPushes([row(1, "inquiry:a", "inbox", "h1", { attempts: 1 }), row(2, "booking_new:a", "bookings"), row(3, "inbox:a:b", "inbox", "h1", { attempts: 2 })]);
    expect(u.map((x) => x.ids)).toEqual([[1, 3], [2]]);
    expect(u[0]).toMatchObject({ title: "2 neue Anfragen und Nachrichten", attempts: 2 });
  });
});
