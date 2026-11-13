import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/admin/PwaRegister";

// Admin als installierbare Web-App (PWA). Manifest, Icon und Service Worker gelten nur unter /admin,
// die Hotel-Websites sind davon nicht betroffen.
export const metadata: Metadata = {
  applicationName: "Pontivo",
  manifest: "/admin/manifest.webmanifest",
  icons: { icon: "/admin/pwa-icon/192", apple: "/admin/pwa-icon/180" },
  appleWebApp: { capable: true, title: "Pontivo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c2427" },
  ],
  viewportFit: "cover",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PwaRegister />
    </>
  );
}
