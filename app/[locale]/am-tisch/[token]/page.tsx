import { TableQrPage } from "@/components/public/TableQrPage";
import { hotelFromHost } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await params;
  return <TableQrPage {...await hotelFromHost(p.locale)} qr={p.token} sp={await searchParams} />;
}
