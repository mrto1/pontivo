export type PlanTable = { id: string; name: string; seats: number; shape: "square" | "round" | "rect"; x: number | null; y: number | null; areaId?: string | null; waiterId?: string | null; /** offene Bestellung (Kasse): Tisch gilt als besetzt */ busy?: boolean; /** zusätzliche Zeilen in den Einzelheiten (z. B. offene Bestellung) */ extra?: string[]; tone?: "free" | "busy" | "soon"; /** kurz im Tisch, z. B. «frei bis 20:00» */ info?: string; /** Einzelheiten beim Antippen */ detail?: string[]; href?: string; hrefLabel?: string; /** weitere Links in den Einzelheiten (z. B. zweite offene Bestellung) */ links?: { href: string; label: string }[]; /** Knopf «Bestellung eröffnen» (Kasse) */ openLabel?: string; /** abgeblendet (Filter) */ dim?: boolean };
export type PlanArea = { id: string; name: string };
export type PlanItemView = { id: string; kind: string; label: string; x: number; y: number; w: number; h: number; areaId: string };
/** Reservierung in der Liste neben dem Plan */
export type PlanRes = { id: string; time: string; name: string; party: number; tableId: string | null; /** zusammengelegte Tische */ extraTableIds?: string[]; status: string; note?: string };

export type PlanWaiter = { id: string; name: string; color: string };
