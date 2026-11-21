import type { NextConfig } from "next";

/**
 * Sicherheits-Kopfzeilen. Bewusst keine strenge script-src-Richtlinie: Next.js, Stripe (Einbindung im Admin) und die Einbettung
 * der Buchungsseite auf Hotel-Websites würden sonst brechen. Der Admin darf nie in einem fremden Rahmen erscheinen.
 */
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

export const adminHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pg-boss"],
  // PDF-Upload der KI-Einrichtung (höchstens 4 MB) und Bankdateien
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: adminHeaders },
      { source: "/plattform/:path*", headers: adminHeaders },
    ];
  },
  // Alte Adressen (E-Mail-Links, Lesezeichen, Push): Hotel-Oberfläche früher /mypontivo, Plattform-Verwaltung früher /admin/plattform.
  async redirects() {
    return [
      { source: "/admin/plattform/:path*", destination: "/plattform/:path*", permanent: true },
      { source: "/admin/plattform", destination: "/plattform", permanent: true },
      { source: "/mypontivo/:path*", destination: "/admin/:path*", permanent: true },
      { source: "/mypontivo", destination: "/admin", permanent: true },
    ];
  },
};

export default nextConfig;
