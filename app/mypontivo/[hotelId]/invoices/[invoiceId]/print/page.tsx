import { notFound } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { invoiceView } from "@/src/services/invoicing";
import { InvoiceSheet } from "@/components/invoice/InvoiceSheet";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Druckansicht A4 (im Browser «Als PDF speichern») */
export default async function PrintInvoice({ params }: { params: Promise<{ hotelId: string; invoiceId: string }> }) {
  const { hotelId, invoiceId } = await params;
  const { hotel } = await requireHotel(hotelId, "staff", "invoices");
  await requireModule(hotel.id, "invoicing");
  const v = await invoiceView(hotel, invoiceId);
  if (!v || v.invoice.status !== "issued") notFound();
  return <InvoiceSheet hotel={hotel} v={v} />;
}
