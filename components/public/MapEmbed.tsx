"use client";
import { useState } from "react";

/**
 * Karte erst nach Klick laden (Datenschutz: vorher keine Verbindung zu OpenStreetMap).
 */
export function MapEmbed({ lat, lng, label, note, title }: { lat: number; lng: number; label: string; note: string; title: string }) {
  const [on, setOn] = useState(false);
  const d = 0.012;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d * 1.6},${lat - d},${lng + d * 1.6},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return on ? (
    <div className="map-frame"><iframe src={src} title={title} loading="lazy" referrerPolicy="no-referrer" /></div>
  ) : (
    <div className="map-frame map-off">
      <button type="button" className="btn secondary" onClick={() => setOn(true)}>{label}</button>
      <span className="small muted">{note}</span>
    </div>
  );
}
