import { TableTokenPage } from "@/components/public/TablePage";
import { hotelFromSlug } from "@/src/lib/public-hotel";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string; locale: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await params;
  const { locale } = p;
  return <TableTokenPage {...await hotelFromSlug(p.slug, p.locale)} token={p.token} sp={await searchParams} />;
}
