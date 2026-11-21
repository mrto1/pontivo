"use server";
import { revalidatePath } from "next/cache";
import { requireHotel } from "@/src/auth/guard";
import { isSeenKind } from "@/src/domain/unseen";
import { markSeen } from "@/src/services/unseen";

/** «Gesehen» für die angemeldete Person (SPEC 20.1); lädt die Zahlen im Menü neu */
export async function markSeenAction(hotelId: string, kind: string): Promise<void> {
  if (!isSeenKind(kind)) return;
  const { hotel, user } = await requireHotel(hotelId, "staff", "layout");
  await markSeen(user.id, hotel.id, kind);
  revalidatePath(`/admin/${hotel.id}`, "layout");
}
