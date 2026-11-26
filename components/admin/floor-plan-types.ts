export type PlanTable = { id: string; name: string; seats: number; shape: "square" | "round" | "rect"; x: number | null; y: number | null; areaId?: string | null; tone?: "free" | "busy" | "soon"; /** kurz im Tisch, z. B. «frei bis 20:00» */ info?: string; /** Einzelheiten beim Antippen */ detail?: string[]; href?: string; hrefLabel?: string; /** abgeblendet (Filter) */ dim?: boolean };
export type PlanArea = { id: string; name: string };
export type PlanItemView = { id: string; kind: string; label: string; x: number; y: number; w: number; h: number; areaId: string };
/** Reservierung in der Liste neben dem Plan */
export type PlanRes = { id: string; time: string; name: string; party: number; tableId: string | null; status: string; note?: string };
