"use client";
import { useEffect } from "react";

/** Service Worker nur für /admin (Offline-Hinweis). Es wird nichts anderes zwischengespeichert. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" }).catch(() => null);
  }, []);
  return null;
}
