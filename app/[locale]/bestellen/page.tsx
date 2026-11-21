import { OrderPage } from "@/components/public/OrderPage";
import { hotelFromHost } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  return <OrderPage {...await hotelFromHost(locale)} sp={await searchParams} />;
}
