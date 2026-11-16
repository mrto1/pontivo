import { currentUserId } from "../auth/guard";
import { getUser, hotelsForUser } from "../auth/session";

/** Für die öffentlichen Plattform-Seiten: ist jemand angemeldet, und wohin führt «Zu myPontivo»? */
export async function accountLink(): Promise<{ label: string } | null> {
  const id = await currentUserId();
  const user = id ? await getUser(id) : null;
  if (!user) return null;
  const list = await hotelsForUser(user.id);
  return { label: list.length === 1 && !user.isPlatformAdmin ? `Zu ${list[0].hotel.name}` : "Zu myPontivo" };
}
