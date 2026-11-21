import { TablePage } from "@/components/public/TablePage";
import { hotelFromHost } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  return <TablePage {...await hotelFromHost(locale)} sp={await searchParams} />;
}
