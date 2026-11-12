import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { airbnbHandleReturn } from "@/src/integrations/channex/airbnb";
import { channelErrorText } from "@/src/integrations/channex/channels";

export const dynamic = "force-dynamic";

/** Rücksprung nach der Freigabe auf Airbnb: Channex hängt success, channel_id und token an. */
export async function GET(req: Request, { params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, actor } = await requireHotel(hotelId, "manager");
  const q = new URL(req.url).searchParams;
  let msg: string;
  try {
    msg = await airbnbHandleReturn(hotel, { success: q.get("success"), channel_id: q.get("channel_id"), token: q.get("token") }, actor);
  } catch (e) {
    msg = `Fehler: ${channelErrorText(e)}`;
  }
  redirect(`/admin/${hotel.id}/channex/airbnb?msg=${encodeURIComponent(msg)}`);
}
