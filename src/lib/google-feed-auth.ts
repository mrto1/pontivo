import { timingSafeEqual } from "node:crypto";
import { env } from "../env";

/** Google ruft Hotelliste und Landingpage-Datei ohne Anmeldung ab: geheimer Wert in der Adresse (`?token=`), Vergleich ohne Zeitunterschied */
export function feedAuthorized(req: Request): boolean {
  const want = env().GOOGLE_HOTELS_FEED_TOKEN;
  if (!want) return false;
  const got = new URL(req.url).searchParams.get("token") ?? "";
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
