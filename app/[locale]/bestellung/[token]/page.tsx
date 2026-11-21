import { OrderStatusPage } from "@/components/public/OrderPage";
import { hotelFromHost } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await params;
  return <OrderStatusPage {...await hotelFromHost(p.locale)} token={p.token} sp={await searchParams} />;
}
