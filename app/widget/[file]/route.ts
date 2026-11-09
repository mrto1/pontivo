import { hotelLocales } from "@/src/i18n/dict";
import { getHotelBySlug } from "@/src/services/hotels";
import { publicBase } from "@/src/services/brand";
import { HEX, inkOn } from "@/src/domain/brand";

export const dynamic = "force-dynamic";

/**
 * Buchungs-Knopf / Suchleiste zum Einbauen in die bestehende Website eines Hotels.
 *   <div data-pontivo="<slug>" data-mode="button|search" data-lang="de|en|fr|it|nl"></div>  (nur Sprachen, die das Hotel anbietet)
 *   <script src="<APP_BASE_URL>/widget/<slug>.js" async></script>
 * Rendert in ein Shadow DOM (keine Konflikte mit dem CSS der Hotel-Website) und öffnet die Buchungsseite.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const slug = file.replace(/\.js$/, "");
  const js = (body: string, status = 200) =>
    new Response(body, {
      status,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    });
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return js("/* ungültig */", 404);
  const hotel = await getHotelBySlug(slug);
  if (!hotel) return js(`console.warn("Pontivo: Hotel ${slug} nicht gefunden");`, 404);
  const color = hotel.content.brand?.color && HEX.test(hotel.content.brand.color) ? hotel.content.brand.color : "#2f5d50";
  const config = { slug, base: publicBase(hotel), color, ink: inkOn(color), lang: hotel.defaultLanguage === "en" ? "en" : "de", langs: hotelLocales(hotel) };
  // JSON sicher in JS einbetten
  const cfg = JSON.stringify(config).replace(/</g, "\\u003c");
  return js(WIDGET.replace("__CONFIG__", cfg));
}

const WIDGET = String.raw`(function () {
  var C = __CONFIG__;
  var T = {
    de: { book: "Jetzt buchen", checkin: "Anreise", checkout: "Abreise", adults: "Erwachsene", children: "Kinder", search: "Verfügbarkeit prüfen" },
    en: { book: "Book now", checkin: "Check-in", checkout: "Check-out", adults: "Adults", children: "Children", search: "Check availability" },
    fr: { book: "Réserver", checkin: "Arrivée", checkout: "Départ", adults: "Adultes", children: "Enfants", search: "Vérifier la disponibilité" },
    it: { book: "Prenota", checkin: "Arrivo", checkout: "Partenza", adults: "Adulti", children: "Bambini", search: "Verifica disponibilità" },
    nl: { book: "Nu boeken", checkin: "Aankomst", checkout: "Vertrek", adults: "Volwassenen", children: "Kinderen", search: "Beschikbaarheid bekijken" }
  };
  function iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); }
  function css() {
    return ":host{all:initial;font-family:inherit;color:inherit}" +
      "*{box-sizing:border-box;font-family:inherit}" +
      ".btn{display:inline-block;background:" + C.color + ";color:" + C.ink + ";border:0;border-radius:8px;padding:12px 20px;font-weight:600;font-size:16px;cursor:pointer;text-decoration:none;line-height:1.2}" +
      ".btn:hover{filter:brightness(1.07)}.btn:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid " + C.color + ";outline-offset:2px}" +
      "form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;background:#fff;color:#1f2a2e;border-radius:12px;padding:14px;box-shadow:0 2px 12px rgba(0,0,0,.12)}" +
      "label{display:flex;flex-direction:column;font-size:13px;gap:4px;flex:1 1 130px;min-width:0}" +
      "input,select{font-size:15px;padding:9px 10px;border:1px solid #cfd6d4;border-radius:7px;background:#fff;color:#1f2a2e;width:100%}" +
      "form .btn{flex:1 1 180px}";
  }
  function bookUrl(lang, q) { return C.base + "/" + lang + (q ? "/book?" + q : ""); }
  function render(el) {
    if (el.__pontivo) return; el.__pontivo = true;
    var want = el.getAttribute("data-lang");
    var lang = want && C.langs.indexOf(want) >= 0 ? want : C.lang;
    var t = T[lang];
    var target = el.getAttribute("data-target") === "_blank" ? "_blank" : "_self";
    var root = el.attachShadow ? el.attachShadow({ mode: "open" }) : el;
    var style = document.createElement("style"); style.textContent = css(); root.appendChild(style);
    if (el.getAttribute("data-mode") !== "search") {
      var a = document.createElement("a");
      a.className = "btn"; a.href = bookUrl(lang); a.target = target; a.rel = "noopener";
      a.textContent = el.getAttribute("data-label") || t.book;
      root.appendChild(a); return;
    }
    var today = iso(new Date());
    var f = document.createElement("form");
    f.innerHTML =
      '<label>' + t.checkin + '<input type="date" name="checkin" required></label>' +
      '<label>' + t.checkout + '<input type="date" name="checkout" required></label>' +
      '<label>' + t.adults + '<select name="adults"></select></label>' +
      '<label>' + t.children + '<select name="children"></select></label>' +
      '<button class="btn" type="submit">' + t.search + '</button>';
    root.appendChild(f);
    var ci = f.querySelector("[name=checkin]"), co = f.querySelector("[name=checkout]");
    ci.min = today; ci.value = addDays(today, 1); co.min = addDays(today, 1); co.value = addDays(today, 3);
    ci.addEventListener("change", function () { co.min = addDays(ci.value, 1); if (co.value <= ci.value) co.value = addDays(ci.value, 1); });
    var ad = f.querySelector("[name=adults]"), ch = f.querySelector("[name=children]");
    for (var i = 1; i <= 6; i++) ad.add(new Option(String(i), String(i), i === 2, i === 2));
    for (var k = 0; k <= 4; k++) ch.add(new Option(String(k), String(k)));
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = "checkin=" + ci.value + "&checkout=" + co.value + "&adults=" + ad.value + "&children=" + ch.value;
      if (target === "_blank") window.open(bookUrl(lang, q), "_blank", "noopener"); else window.location.href = bookUrl(lang, q);
    });
  }
  function init() { var els = document.querySelectorAll('[data-pontivo="' + C.slug + '"]'); for (var i = 0; i < els.length; i++) render(els[i]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();`;
