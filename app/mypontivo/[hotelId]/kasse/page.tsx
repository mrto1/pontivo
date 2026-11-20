import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { invoicingSettings } from "@/src/services/invoicing";
import { OfflineKasse } from "@/components/pos/OfflineKasse";

export const dynamic = "force-dynamic";

/** Kasse, die auch ohne Verbindung weiterläuft (SPEC 19.16, Offline-Betrieb) */
export default async function KassePage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel } = await requireHotel(hotelId, "staff", "kasse");
  await requireModule(hotel.id, "pos");
  return (
    <div className="stack">
      <h1>Kasse</h1>
      <OfflineKasse hotelId={hotel.id} vatLiable={invoicingSettings(hotel).vatLiable} />
    </div>
  );
}
