import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { finishCardSetup } from "@/src/services/billing";

export const dynamic = "force-dynamic";

/** Rückkehr von Stripe (Karte hinterlegt): Session auslesen, speichern, zurück zur Ausgangsseite */
export default async function CardReturn({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, actor } = await requireHotel(hotelId, "owner");
  // nur Rücksprung innerhalb des eigenen Admins zulassen
  const back = sp.back && sp.back.startsWith(`/admin/${hotel.id}/`) && !sp.back.includes("//") ? sp.back : `/admin/${hotel.id}/settings#karte`;
  const sep = back.includes("?") ? "&" : "?";
  let msg: string;
  try {
    const r = await finishCardSetup(hotel, String(sp.session_id ?? ""), actor);
    msg = `Karte hinterlegt: ${r.label}`;
  } catch (e) {
    msg = `Karte nicht gespeichert: ${(e as Error).message}`;
  }
  redirect(`${back.split("#")[0]}${sep}msg=${encodeURIComponent(msg)}`);
}
