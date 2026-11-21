import { TableTokenPage } from "@/components/public/TablePage";
import { hotelFromHost } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await params;
  const { locale } = p;
  return <TableTokenPage {...await hotelFromHost(p.locale)} token={p.token} sp={await searchParams} />;
}
