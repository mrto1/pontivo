import { notFound } from "next/navigation";
import { getBookingByToken } from "@/src/services/bookings";
import { invoiceView } from "@/src/services/invoicing";
import { InvoiceSheet } from "@/components/invoice/InvoiceSheet";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Rechnung für den Gast: nur über den persönlichen Buchungslink, nur ausgestellte Rechnungen dieser Buchung */
export default async function GuestInvoice({ params }: { params: Promise<{ token: string; invoiceId: string }> }) {
  const { token, invoiceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) notFound();
  const found = await getBookingByToken(token);
  if (!found) notFound();
  const v = await invoiceView(found.hotel, invoiceId);
  if (!v || v.invoice.status !== "issued" || v.invoice.bookingId !== found.booking.id) notFound();
  return <InvoiceSheet hotel={found.hotel} v={v} />;
}
