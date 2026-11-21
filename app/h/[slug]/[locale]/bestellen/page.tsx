import { OrderPage } from "@/components/public/OrderPage";
import { hotelFromSlug } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string; locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, locale } = await params;
  return <OrderPage {...await hotelFromSlug(slug, locale)} sp={await searchParams} />;
}
