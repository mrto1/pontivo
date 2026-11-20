import { MetaChannelView } from "../_meta/view";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  return <MetaChannelView hotelId={hotelId} channel="BookingCom" msg={sp.msg} />;
}
