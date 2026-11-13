export const dynamic = "force-static";

/**
 * Service Worker der Admin-PWA. Bewusst minimal: eine Offline-Seite für Seitenaufrufe unter /admin und Push-Mitteilungen.
 * Buchungen und Kalender werden nie zwischengespeichert, damit nie veraltete Daten erscheinen.
 */
const SW = `const CACHE = "pontivo-admin-v2";
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
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "Pontivo", {
    body: d.body || "",
    icon: "/admin/pwa-icon/192",
    badge: "/admin/pwa-icon/192",
    tag: d.tag,
    data: { url: typeof d.url === "string" && d.url.startsWith("/admin/") ? d.url : "/admin" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/admin";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (w.url.includes("/admin") && "focus" in w) return w.navigate(url).then(() => w.focus());
    return self.clients.openWindow(url);
  }));
});
`;

export function GET() {
  return new Response(SW, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/admin/" },
  });
}
