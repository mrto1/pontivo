import { currentUserId } from "../auth/guard";
import { getUser } from "../auth/session";

/** Für die öffentlichen Plattform-Seiten: ist jemand angemeldet, und wohin führt «Verwaltung»? */
export async function accountLink(): Promise<{ label: string } | null> {
  const id = await currentUserId();
  const user = id ? await getUser(id) : null;
  if (!user) return null;
  return { label: "Verwaltung" };
}
