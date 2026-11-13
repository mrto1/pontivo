export const dynamic = "force-static";

/**
 * Service Worker der Admin-PWA. Bewusst minimal: nur eine Offline-Seite für Seitenaufrufe unter /admin.
 * Buchungen und Kalender werden nie zwischengespeichert, damit nie veraltete Daten erscheinen.
 */
const SW = `const CACHE = "pontivo-admin-v1";
const OFFLINE = "/admin/offline";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode !== "navigate" || !new URL(req.url).pathname.startsWith("/admin")) return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
`;

export function GET() {
  return new Response(SW, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/admin/" },
  });
}
