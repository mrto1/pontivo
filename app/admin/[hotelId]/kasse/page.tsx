import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { invoicingSettings } from "@/src/services/invoicing";
import { OfflineKasse } from "@/components/pos/OfflineKasse";

export const dynamic = "force-dynamic";

/** Kasse, die auch ohne Verbindung weiterläuft (SPEC 19.16, Offline-Betrieb) */
export default async function KassePage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel } = await requireHotelModule("pos", hotelId, "staff", "kasse");
  return (
    <div className="stack">
      <h1 className="sr-only">Kasse</h1>
      <OfflineKasse hotelId={hotel.id} vatLiable={invoicingSettings(hotel).vatLiable} />
    </div>
  );
}
