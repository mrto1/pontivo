import { redirect } from "next/navigation";

/** Früher «Bestellungen → Tische»; seit SPEC 19.64 ist alles im Tischplan (Reservationen, offene Bestellungen, Eröffnen). Alte Links leiten weiter. */
export default async function RestaurantPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  redirect(`/admin/${hotelId}/restaurant/tischplan${sp.msg ? `?msg=${encodeURIComponent(sp.msg)}` : ""}`);
}
