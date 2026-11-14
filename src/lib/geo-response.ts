import { headers } from "next/headers";
import { getHotelByHost, getHotelBySlug } from "../services/hotels";
import { llmsTxt, robotsTxt, sitemapXml } from "../services/geo";
import type { Hotel } from "../db/schema";

const CACHE = "public, max-age=600"; // zehn Minuten genügen: Seiten ändern sich selten
const text = (body: string, type: string) => new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": CACHE } });

async function hotelOfHost(): Promise<Hotel | null> {
  return getHotelByHost((await headers()).get("host"));
}

/** Hotel über die eigene Domain; Plattform-Domain ohne Hotel → 404 (ausser robots.txt) */
export async function sitemapForHost() {
  const h = await hotelOfHost();
  return h ? text(await sitemapXml(h), "application/xml") : new Response("Not found", { status: 404 });
}
export async function llmsForHost() {
  const h = await hotelOfHost();
  return h ? text(await llmsTxt(h), "text/plain") : new Response("Not found", { status: 404 });
}
export async function robotsForHost() {
  const h = await hotelOfHost();
  return text(robotsTxt(h), "text/plain");
}
/** Vorschau-Adresse /h/<slug>/… (vor der Domain-Umstellung) */
export async function sitemapForSlug(slug: string) {
  const h = await getHotelBySlug(slug);
  return h ? text(await sitemapXml(h), "application/xml") : new Response("Not found", { status: 404 });
}
export async function llmsForSlug(slug: string) {
  const h = await getHotelBySlug(slug);
  return h ? text(await llmsTxt(h), "text/plain") : new Response("Not found", { status: 404 });
}
