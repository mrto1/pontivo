import { permanentRedirect } from "next/navigation";

/** Eingebunden in «Website und Buchung» (Menü neu geordnet); alte Adresse bleibt gültig */
export default async function Embed({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  permanentRedirect(`/mypontivo/${hotelId}/site#einbinden`);
}
