import { cookies } from "next/headers";

/** Entwurf der Tischreservation nach einem Fehler (Server Action setzt ihn, die Seite füllt die Felder vor) */
export const DRAFT_COOKIE = "res_draft";
export type ReservationDraft = { name: string; email: string; phone: string; note: string; time: string };

export async function readDraft(): Promise<ReservationDraft | null> {
  const raw = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (!raw) return null;
  try {
    const d = JSON.parse(decodeURIComponent(raw)) as Partial<ReservationDraft>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    return { name: str(d.name, 80), email: str(d.email, 200), phone: str(d.phone, 40), note: str(d.note, 300), time: str(d.time, 5) };
  } catch { return null; }
}
