import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/admin/PwaRegister";

// Admin als installierbare Web-App (PWA). Manifest, Icon und Service Worker gelten nur unter /mypontivo,
// die Hotel-Websites sind davon nicht betroffen.
export const metadata: Metadata = {
  applicationName: "myPontivo",
  manifest: "/mypontivo/manifest.webmanifest",
  icons: { icon: "/mypontivo/pwa-icon/192", apple: "/mypontivo/pwa-icon/180" },
  appleWebApp: { capable: true, title: "myPontivo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#131c2e" },
  ],
  viewportFit: "cover",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pv-admin">
      {children}
      <PwaRegister />
    </div>
  );
}
