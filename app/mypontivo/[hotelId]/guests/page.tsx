import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Alte Adresse (früher «Check-in & Meldeschein»): Anreisen stehen in der Tagesliste, Listen und Exporte unter Finanzen → Berichte (SPEC 19.46) */
export default async function Guests({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  redirect(`/mypontivo/${hotelId}/berichte`);
}
