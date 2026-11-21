"use client";
import { useEffect } from "react";

/** Nach erfolgreicher Bestellung den Warenkorb im Browser leeren (Kontaktangaben bleiben) */
export function ClearCart({ hotelId }: { hotelId: string }) {
  useEffect(() => {
    try {
      const k = `pv_cart_${hotelId}`;
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      if (v) localStorage.setItem(k, JSON.stringify({ ...v, lines: [] }));
    } catch { /* egal */ }
  }, [hotelId]);
  return null;
}
