import { isOn } from "../domain/modules";

/**
 * Getrennter Posteingang (SPEC 20.1): Führt der Betrieb auch das Restaurant, gehören Tischanfragen in den Posteingang der Gastronomie,
 * alles andere (Gästewünsche, Portal-Nachrichten, übrige Anfragen) in den der Unterkunft. Ohne Restaurant bleibt alles in einem Posteingang.
 * Modulzugriff lazy: dieser Code läuft auch in Tests ohne Next.
 */
export async function inboxSplit(hotelId: string): Promise<boolean> {
  const { moduleRows } = await import("./modules");
  return isOn(await moduleRows(hotelId), "restaurant");
}
