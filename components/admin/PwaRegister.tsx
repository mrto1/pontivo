"use client";
import { useEffect } from "react";

/** Service Worker nur für /mypontivo (Offline-Hinweis). Es wird nichts anderes zwischengespeichert. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/mypontivo/sw.js", { scope: "/mypontivo/", updateViaCache: "none" }).catch(() => null);
  }, []);
  return null;
}
