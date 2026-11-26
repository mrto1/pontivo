import { test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { hotelModules, hotels, users } from "../../src/db/schema";
import { SESSION_COOKIE, createSessionValue } from "../../src/auth/session";
import { addMember } from "../../src/services/settings";
import { MODULES } from "../../src/domain/modules";
import { saveItem, saveTable } from "../../src/services/pos";
import { saveItemOnline } from "../../src/services/online-orders";
import { ensureQrToken } from "../../src/services/table-pay";
import { makeHotel } from "../helpers";

/** UI-Durchgang (nur mit UI_AUDIT=1): Screenshots und Messungen je Seite, Desktop und Mobil */
test.skip(!process.env.UI_AUDIT, "nur mit UI_AUDIT=1");
test.setTimeout(30 * 60_000);

const ADMIN = ["", "bookings", "bookings/new", "calendar", "preise", "plan", "housekeeping", "guests", "guestbook", "groups", "inquiries", "inbox", "invoices", "invoices/debitoren", "invoices/tagesabschluss", "zahlungen", "buchhaltung", "report", "berichte", "statistics", "statistics/hesta", "rooms", "rooms/extras", "settings", "einstellungen", "team", "konto", "site", "direktbuchung", "embed", "funktionen", "vouchers", "shop", "upsell", "marketing", "feedback", "mail-texte", "resources", "resources/angebote", "owners", "channex", "ical", "hilfe", "erste-woche", "einrichten", "gaesteportal", "zutritt", "terminal", "kasse",
  "restaurant", "restaurant/heute", "restaurant/reservierungen", "restaurant/tischplan", "restaurant/tische", "restaurant/warteliste", "restaurant/kueche", "restaurant/artikel", "restaurant/einstellungen", "restaurant/bestellungen", "restaurant/bestellung-einstellungen", "restaurant/fahrer", "restaurant/online-verkaeufe", "restaurant/auswertung", "restaurant/tisch-qr", "restaurant/geraete", "restaurant/abschluss"];

const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const sel = (e: Element) => { const c = (e.getAttribute("class") || "").trim().split(/\s+/).slice(0, 3).join("."); return `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${c ? "." + c : ""}`; };
  const over: string[] = [];
  for (const e of Array.from(document.body.querySelectorAll("*"))) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && getComputedStyle(e).position !== "fixed") {
      let p = e.parentElement, clipped = false;
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") { clipped = true; break; } p = p.parentElement; }
      if (!clipped) over.push(`${sel(e)} → ${Math.round(r.right)}px`);
    }
  }
  const small: string[] = [];
  for (const e of Array.from(document.querySelectorAll("a, button, input:not([type=hidden]), select, summary, [role=button]"))) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (e.tagName === "A" && getComputedStyle(e).display === "inline" && !(e as HTMLElement).className) continue; // Fliesstext-Links
    if ((e as HTMLInputElement).type === "checkbox" || (e as HTMLInputElement).type === "radio") continue;
    if (r.height < 32) small.push(`${sel(e)} ${Math.round(r.width)}×${Math.round(r.height)} «${((e as HTMLElement).innerText || (e as HTMLInputElement).value || "").trim().slice(0, 20)}»`);
  }
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  const fields = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select")).filter(vis);
  // Knopf direkt neben einem Feld (gleiche Zeile), aber andere Höhe
  const btnMismatch: string[] = [];
  for (const b of Array.from(document.querySelectorAll("button, .btn")).filter(vis)) {
    const rb = b.getBoundingClientRect();
    for (const f of fields) {
      const rf = f.getBoundingClientRect();
      const sameRow = Math.abs((rb.top + rb.bottom) / 2 - (rf.top + rf.bottom) / 2) < 14;
      const near = rb.left - rf.right >= -1 && rb.left - rf.right < 40;
      if (sameRow && near && Math.abs(rb.height - rf.height) > 2) { btnMismatch.push(`${sel(b)} ${Math.round(rb.height)} vs ${sel(f)} ${Math.round(rf.height)} «${(b as HTMLElement).innerText.trim().slice(0, 16)}»`); break; }
    }
  }
  // Felder in derselben Rasterzeile mit versetzter Oberkante
  const misaligned: string[] = [];
  for (const g of Array.from(document.querySelectorAll(".form-grid, .form-row, .grid, .inline-form"))) {
    const cells = Array.from(g.children).filter(vis);
    const rows = new Map<number, number[]>();
    for (const c of cells) {
      const f = c.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea");
      if (!f || !vis(f)) continue;
      const top = Math.round(c.getBoundingClientRect().top);
      rows.set(top, [...(rows.get(top) ?? []), Math.round(f.getBoundingClientRect().top)]);
    }
    for (const tops of rows.values()) if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 2) { misaligned.push(`${sel(g)} Δ${Math.max(...tops) - Math.min(...tops)}px`); break; }
  }
  // fixe Leiste unten verdeckt am Seitenende Inhalt?
  window.scrollTo(0, document.documentElement.scrollHeight);
  const fixedBottom = Array.from(document.querySelectorAll("body *")).filter((e) => { const cs = getComputedStyle(e); if (cs.position !== "fixed" || !vis(e)) return false; const r = e.getBoundingClientRect(); return r.bottom >= innerHeight - 2 && r.height < 160 && r.width > innerWidth * 0.5; });
  let covered = "";
  if (fixedBottom.length) {
    const top = Math.min(...fixedBottom.map((e) => e.getBoundingClientRect().top));
    for (const e of Array.from(document.querySelectorAll("main *, footer *, .foot *, p, a, button, h2, h3, li, td"))) {
      if (fixedBottom.some((f) => f.contains(e)) || !vis(e) || e.children.length) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom > top + 2 && r.top < innerHeight && ((e as HTMLElement).innerText || "").trim()) { covered = `${sel(e)} «${(e as HTMLElement).innerText.trim().slice(0, 30)}» unter ${sel(fixedBottom[0])}`; break; }
    }
  }
  window.scrollTo(0, 0);
  const unlabeled = fields.concat(Array.from(document.querySelectorAll("textarea")).filter(vis)).filter((f) => !(f as HTMLInputElement).labels?.length && !f.getAttribute("aria-label") && !f.getAttribute("aria-labelledby") && !f.getAttribute("title")).map((f) => `${sel(f)}[name=${f.getAttribute("name")}]`);
  const ids = new Map<string, number>();
  for (const e of Array.from(document.querySelectorAll("[id]"))) ids.set(e.id, (ids.get(e.id) ?? 0) + 1);
  const dupIds = [...ids].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
  const inline = document.querySelectorAll("[style]").length;
  const err = /Application error|Unhandled Runtime Error|Internal Server Error|This page could not be found/i.test(document.body.innerText);
  const fonts = new Set(Array.from(document.querySelectorAll("h1,h2,h3")).map((e) => `${e.tagName}:${getComputedStyle(e).fontSize}`));
  return { dupIds: dupIds.slice(0, 8), unlabeled: unlabeled.slice(0, 6), unlabeledCount: unlabeled.length, btnMismatch: btnMismatch.slice(0, 6), misaligned: misaligned.slice(0, 6), covered, scrollW: document.documentElement.scrollWidth, vw, over: over.slice(0, 8), small: small.slice(0, 12), smallCount: small.length, inline, err, fonts: [...fonts] };
};

test("UI-Durchgang", async ({ browser, baseURL }) => {
  const m = await makeHotel();
  const id = m.hotel.id;
  await db().insert(hotelModules).values(MODULES.map((x) => ({ hotelId: id, module: x.key, enabled: true }))).onConflictDoNothing();
  await db().update(hotels).set({ stripeAccountId: `acct_${crypto.randomUUID()}`, stripeChargesEnabled: true }).where(eq(hotels.id, id));
  const [h] = await db().select().from(hotels).where(eq(hotels.id, id));
  const it = await saveItem(id, null, { category: "Hauptgang", name: "Rösti mit Spiegelei", priceRappen: 2400, vatDineInBps: 810, vatTakeawayBps: 260 }, "e2e");
  await saveItemOnline(id, it.id, { online: true, description: "Knusprig, mit Bergkäse", photoUrl: null, allergens: [] }, "e2e");
  const t = await saveTable(id, "Tisch 1", "e2e");
  await saveTable(id, "Tisch 2", "e2e");
  const qr = await ensureQrToken(id, t.id);
  const email = `audit-${Math.random().toString(36).slice(2, 8)}@example.ch`;
  await addMember(id, email, "owner", "e2e");
  const [u] = await db().select().from(users).where(eq(users.email, email));
  const pub = [`/h/${h.slug}/de`, `/h/${h.slug}/de/book`, `/h/${h.slug}/de/tisch`, `/h/${h.slug}/de/am-tisch/${qr}`, `/h/${h.slug}/de/bestellen`, "/", "/admin/login", "/registrieren", "/restaurant", "/unterkunft"];
  const out: Record<string, unknown>[] = [];
  for (const [vp, w, hgt] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
    mkdirSync(`/tmp/ui-audit/${vp}`, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, isMobile: vp === "mobile", hasTouch: vp === "mobile", locale: "de-CH" });
    await ctx.addCookies([{ name: SESSION_COOKIE, value: createSessionValue(u.id), url: baseURL! }]);
    const page = await ctx.newPage();
    for (const path of [...ADMIN.map((p) => `/admin/${id}${p ? "/" + p : ""}`), ...pub]) {
      const name = path.replace(id, "H").replace(h.slug, "S").replace(qr, "QR").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
      try {
        const res = await page.goto(path, { waitUntil: "networkidle", timeout: 90_000 });
        const r = await page.evaluate(MEASURE);
        await page.screenshot({ path: `/tmp/ui-audit/${vp}/${name}.png`, fullPage: true, timeout: 30_000 }).catch(() => null);
        out.push({ vp, path: name, status: res?.status(), url: page.url().replace(baseURL!, ""), ...r });
      } catch (e) { out.push({ vp, path: name, error: String(e).slice(0, 200) }); }
    }
    await ctx.close();
  }
  writeFileSync("/tmp/ui-audit/report.json", JSON.stringify(out, null, 1));
});
