export const dynamic = "force-static";

export function GET() {
  const manifest = {
    name: "Pontivo",
    short_name: "Pontivo",
    description: "Direktbuchung für Hotels und Ferienwohnungen",
    id: "/admin",
    start_url: "/admin",
    scope: "/admin/",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#2f5d50",
    lang: "de",
    icons: [
      { src: "/admin/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/admin/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/admin/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
