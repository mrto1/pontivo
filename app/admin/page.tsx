import { redirect } from "next/navigation";
import { requireUser } from "@/src/auth/guard";

export const dynamic = "force-dynamic";

/**
 * /admin ist der Bereich der Plattform-Verwaltung (nur Plattform-Admins); die Hotels arbeiten unter /mypontivo.
 * Wer nicht angemeldet ist, meldet sich bei myPontivo an; wer kein Plattform-Admin ist, landet bei seinen Betrieben.
 */
export default async function AdminHome() {
  const user = await requireUser();
  redirect(user.isPlatformAdmin ? "/admin/plattform" : "/mypontivo");
}
