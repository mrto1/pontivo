"use client";
import { useRef, useState } from "react";

type Photo = { url: string; alt?: string };

/**
 * Fotos eines Hotels oder Zimmertyps: Reihenfolge per Drag & Drop ändern (das erste Foto ist automatisch das Titelbild),
 * entfernen mit dem roten ✕ oben rechts. Maus: Bild ziehen. Touch: am Griff unten links ziehen (sonst würde das Scrollen blockiert).
 * Ohne JavaScript bleibt das ✕ als normales Formular nutzbar.
 */
export function PhotoGrid({ photos, canEdit, action, hidden }: { photos: Photo[]; canEdit: boolean; action: (f: FormData) => void | Promise<void>; hidden: Record<string, string> }) {
  const [order, setOrder] = useState<string[]>(photos.map((p) => p.url));
  const [drag, setDrag] = useState<string | null>(null);
  const latest = useRef<string[]>(order); // aktuelle Reihenfolge ausserhalb des Renderns (für das Speichern beim Loslassen)
  const formRef = useRef<HTMLFormElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);
  const start = useRef<{ url: string; x: number; y: number; active: boolean; from: string[] } | null>(null);
  const byUrl = new Map(photos.map((p) => [p.url, p]));
  const sortable = canEdit && photos.length > 1;

  const down = (e: React.PointerEvent, url: string) => {
    if (!sortable || (e.target as HTMLElement).closest(".photo-x")) return;
    if (e.pointerType === "touch" && !(e.target as HTMLElement).closest(".photo-grip")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { url, x: e.clientX, y: e.clientY, active: false, from: order };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
      st.active = true;
      setDrag(st.url);
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-photo]")?.dataset.photo;
    if (!over || over === st.url) return;
    const cur = latest.current;
    const from = cur.indexOf(st.url), to = cur.indexOf(over);
    if (from < 0 || to < 0 || from === to) return;
    const next = cur.slice();
    next.splice(from, 1);
    next.splice(to, 0, st.url);
    latest.current = next;
    setOrder(next);
  };
  const up = () => {
    const st = start.current;
    start.current = null;
    if (!st?.active) return;
    setDrag(null);
    // Beim Loslassen speichern, wenn sich die Reihenfolge geändert hat
    if (latest.current.join("|") !== st.from.join("|") && orderRef.current) {
      orderRef.current.value = JSON.stringify(latest.current);
      formRef.current?.requestSubmit();
    }
  };

  return (
    <>
      <div className={`photo-grid${sortable ? " sortable" : ""}`}>
        {order.map((url, i) => {
          const p = byUrl.get(url)!;
          return (
            <figure key={url} data-photo={url} className={`photo${drag === url ? " dragging" : ""}`}
              onPointerDown={(e) => down(e, url)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <img src={p.url} alt={p.alt ?? ""} loading="lazy" draggable={false} />
              {i === 0 ? <span className="badge">Titelbild</span> : null}
              {sortable ? (
                <span className="photo-grip" title="Zum Sortieren ziehen" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                </span>
              ) : null}
              {canEdit ? (
                <form action={action} className="photo-x-form">
                  {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                  <input type="hidden" name="url" value={url} />
                  <input type="hidden" name="action" value="remove" />
                  <button className="photo-x" aria-label="Foto entfernen" title="Foto entfernen" onClick={(e) => { if (!confirm("Dieses Foto entfernen?")) e.preventDefault(); }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </form>
              ) : null}
            </figure>
          );
        })}
      </div>
      {sortable ? <p className="muted small">Zum Sortieren ein Foto an die gewünschte Stelle ziehen. Das erste Foto ist das Titelbild.</p> : null}
      {canEdit ? (
        <form ref={formRef} action={action} hidden>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="action" value="order" />
          <input ref={orderRef} type="hidden" name="order" defaultValue="" />
        </form>
      ) : null}
    </>
  );
}
