/**
 * Statische Fassung der Plattform-Website (Startseite, Impressum, Datenschutz, Bedingungen für Gastgeber)
 * für einen einfachen Webspace, bis der eigene Server läuft. Ohne JavaScript ausser dem kleinen Rechner.
 *
 * 1. Server mit STATIC_SITE=1 und PLATFORM_*-Angaben starten (npm run build && STATIC_SITE=1 npm start)
 * 2. node scripts/export-static-site.mjs http://localhost:3000 out/static-site
 * 3. Inhalt des Ordners in den Webspace hochladen (index.html ins Hauptverzeichnis)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "out/static-site";
const pages = [["/", "index.html"], ["/impressum", "impressum.html"], ["/datenschutz", "datenschutz.html"], ["/gastgeber-bedingungen", "gastgeber-bedingungen.html"]];

const CALC = `<script>
(function () {
  var q = function (s) { return document.querySelector(s); };
  var rev = q('[data-calc="rev"]'), com = q('[data-calc="com"]'), sh = q('[data-calc="shift"]');
  if (!rev) return;
  var fee = Number((q('[data-fee]') || {}).dataset ? q('[data-fee]').dataset.fee : 1);
  var chf = function (n) { return "CHF " + Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, "'"); };
  var set = function (k, v) { var e = q('[data-out="' + k + '"]'); if (e) e.textContent = v; };
  function upd() {
    var r = +rev.value, c = +com.value, s = +sh.value, moved = r * s / 100, portal = moved * c / 100, ours = moved * fee / 100;
    set("rev", chf(r)); set("com", c + " %"); set("shift", s + " %"); set("com2", c);
    set("moved", chf(moved)); set("portal", chf(portal)); set("pontivo", chf(ours)); set("saved", chf(portal - ours));
  }
  [rev, com, sh].forEach(function (i) { i.addEventListener("input", upd); });
})();
</script>`;

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "assets"), { recursive: true });
const assets = new Map(); // URL → lokaler Name

async function asset(url) {
  if (assets.has(url)) return assets.get(url);
  const name = `assets/${path.basename(new URL(url, base).pathname)}`;
  const res = await fetch(new URL(url, base));
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await fs.writeFile(path.join(out, name), Buffer.from(await res.arrayBuffer()));
  assets.set(url, name);
  return name;
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [route, file] of pages) {
  await page.goto(new URL(route, base).toString(), { waitUntil: "networkidle" });
  let html = await page.content();
  // CSS einbetten, Schriften als Dateien
  for (const m of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)]) {
    const cssUrl = new URL(m[1], base);
    let css = await (await fetch(cssUrl)).text();
    // Schriften und Bilder in der CSS (relativ zur CSS-Datei) → assets/
    for (const u of [...new Set([...css.matchAll(/url\(["']?([^)"']+\.(?:woff2?|ttf|otf|png|jpe?g|svg|webp))["']?\)/g)].map((x) => x[1]))]) {
      if (u.startsWith("data:")) continue;
      css = css.split(`url(${u})`).join(`url(${await asset(new URL(u, cssUrl).pathname)})`);
    }
    html = html.replace(m[0], `<style>${css}</style>`);
  }
  // kein Next.js-JavaScript, keine Preloads
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link[^>]+rel="(preload|modulepreload)"[^>]*>/g, "");
  // Fotos/Icons aus /_next oder /media lokal ablegen
  for (const u of [...new Set([...html.matchAll(/(?:src|href)="(\/(?:_next\/static|media|icon|favicon)[^"]*)"/g)].map((x) => x[1]))]) html = html.split(`"${u}"`).join(`"${await asset(u)}"`);
  if (file === "index.html") html = html.replace("</body>", `${CALC}</body>`);
  await fs.writeFile(path.join(out, file), html);
  console.log("geschrieben:", file);
}
await browser.close();
console.log(`Fertig: ${out} (${assets.size} Dateien in assets/)`);
