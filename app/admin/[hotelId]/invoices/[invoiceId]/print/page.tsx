import { notFound } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { invoiceView } from "@/src/services/invoicing";
import { InvoiceSheet } from "@/components/invoice/InvoiceSheet";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Druckansicht A4 (im Browser «Als PDF speichern») */
export default async function PrintInvoice({ params }: { params: Promise<{ hotelId: string; invoiceId: string }> }) {
  const { hotelId, invoiceId } = await params;
  const { hotel } = await requireHotelModule("invoicing", hotelId, "staff", "invoices");
  const v = await invoiceView(hotel, invoiceId);
  if (!v || v.invoice.status !== "issued") notFound();
  return <InvoiceSheet hotel={hotel} v={v} />;
}
