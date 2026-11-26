/** Tischplan: reine Logik ohne I/O (SPEC 19.53). */

export type TableShape = "square" | "round" | "rect";
export type TableState = "free" | "reserved" | "seated";

export interface ResLike {
  tableId: string | null;
  time: string; // 'HH:MM'
  status: "confirmed" | "seated" | "cancelled" | "noshow";
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Zustand eines Tisches zu einem Zeitpunkt `at` ('HH:MM').
 * Eine Reservierung belegt den Tisch von `time` bis `time + durationMin`.
 * seated = Gast sitzt (Status seated), reserved = bestätigt und im Fenster.
 */
export function tableState(tableId: string, reservations: ResLike[], at: string, durationMin: number): TableState {
  const t = toMinutes(at);
  let state: TableState = "free";
  for (const r of reservations) {
    if (r.tableId !== tableId) continue;
    if (r.status === "cancelled" || r.status === "noshow") continue;
    const start = toMinutes(r.time);
    if (t < start || t >= start + durationMin) continue;
    if (r.status === "seated") return "seated";
    state = "reserved";
  }
  return state;
}

export const STATE_COLORS: Record<TableState, string> = {
  free: "#2e9e5b",
  reserved: "#e0a21b",
  seated: "#d64545",
};

export interface Chair {
  x: number; // Offset vom Tischmittelpunkt in Einheiten des Tischradius (-1.5..1.5)
  y: number;
}

/** Stühle gleichmässig um den Tisch verteilt. Rund: Kreis; eckig: Ober-/Unterkante zuerst, dann Seiten. */
export function chairLayout(seats: number, shape: TableShape): Chair[] {
  const n = Math.max(0, Math.min(seats, 50));
  if (shape === "round" || n > 12) {
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: round2(1.35 * Math.cos(a)), y: round2(1.35 * Math.sin(a)) };
    });
  }
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  const row = (count: number, y: number) =>
    Array.from({ length: count }, (_, i) => ({ x: round2(count === 1 ? 0 : -0.7 + (1.4 * i) / (count - 1)), y }));
  return [...row(top, -1.35), ...row(bottom, 1.35)];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const PLAN_ITEM_KINDS = ["wc", "bar", "coat", "entrance", "kitchen", "stairs", "wall", "plant", "text"] as const;
export const PLAN_ITEM_LABELS: Record<(typeof PLAN_ITEM_KINDS)[number], string> = {
  wc: "WC",
  bar: "Bar",
  coat: "Garderobe",
  entrance: "Eingang",
  kitchen: "Küche",
  stairs: "Treppe",
  wall: "Wand",
  plant: "Pflanze",
  text: "Text",
};

/** Begrenzt Plankoordinaten auf 0..1000. */
export function clampPlan(v: number): number {
  return Math.max(0, Math.min(1000, Math.round(v)));
}
