import dns from "node:dns";
import https from "node:https";
import net from "node:net";

/**
 * Holt eine vom Gastgeber eingetragene Adresse (SSRF-Schutz, SPEC 7b):
 * nur https, keine internen/privaten Adressen (auch nicht über Weiterleitung oder DNS-Rebinding),
 * Zeitlimit, Grössenlimit, höchstens 3 Weiterleitungen.
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]);
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  }
  return true;
}

export function checkFeedUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Ungültige Adresse");
  }
  if (u.protocol !== "https:") throw new Error("Die Adresse muss mit https:// beginnen");
  if (u.username || u.password) throw new Error("Adresse ohne Benutzername/Passwort angeben");
  if (u.port && u.port !== "443") throw new Error("Nur der Standard-Port ist erlaubt");
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Interne Adressen sind nicht erlaubt");
  if (!u.hostname.includes(".") && !net.isIP(u.hostname)) throw new Error("Ungültiger Servername");
  return u;
}

const lookup: net.LookupFunction = (host, opts, cb) => {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = addrs as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(new Error("Interne Adressen sind nicht erlaubt"), "", 4);
    if ((opts as { all?: boolean }).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

export async function safeFetchText(raw: string, opts: { maxBytes?: number; timeoutMs?: number; lookupFn?: net.LookupFunction } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = checkFeedUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
      const req = https.get(url, { lookup: opts.lookupFn ?? lookup, timeout: opts.timeoutMs ?? 10_000, headers: { "user-agent": "Pontivo-iCal/1.0", accept: "text/calendar, text/plain, */*" } }, (r) => {
        const status = r.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          r.resume();
          return resolve({ status, location: r.headers.location, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        r.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error("Antwort zu gross"));
            return;
          }
          chunks.push(c);
        });
        r.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        r.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("Zeitüberschreitung")));
      req.on("error", reject);
    });
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) throw new Error("Weiterleitung ohne Ziel");
      url = checkFeedUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status !== 200) throw new Error(`Der Server antwortet mit Fehler ${res.status}`);
    return res.body;
  }
  throw new Error("Zu viele Weiterleitungen");
}
