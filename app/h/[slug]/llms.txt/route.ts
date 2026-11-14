import { llmsForSlug } from "@/src/lib/geo-response";

export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  return llmsForSlug((await params).slug);
}
