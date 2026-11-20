import { permanentRedirect } from "next/navigation";

/** Anfragen stehen im gemeinsamen Posteingang; alte Adresse (Mails, Mitteilungen) bleibt gültig */
export default async function Inquiries({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  permanentRedirect(`/mypontivo/${hotelId}/inbox?quelle=web`);
}
