import { redirect } from "next/navigation";

/** «Buchung erfassen» öffnet jetzt als Seitenleiste auf der Buchungsliste; alte Adresse und Lesezeichen leiten dorthin */
export default async function NewBooking({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ neu: "1" });
  for (const [k, v] of Object.entries(sp)) if (v) q.set(k, v);
  redirect(`/admin/${hotelId}/bookings?${q}`);
}
