import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getHotelById } from "../services/hotels";
import { getUser, readSessionValue, roleIn, SESSION_COOKIE } from "./session";
import { canAccess, type FullRole } from "../domain/roles";

export async function currentUserId(): Promise<string | null> {
  return readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireUser() {
  const id = await currentUserId();
  const user = id ? await getUser(id) : null;
  if (!user) redirect("/admin/login");
  return user;
}

/**
 * Admin-Seiten und Server Actions: Zugriff auf genau dieses Hotel mit Mindestrolle, sonst 404.
 * `area`: Bereich der Seite (Menü-Schlüssel). Nur damit dürfen eingeschränkte Rollen (Rezeption, Reinigung, Buchhaltung) hinein (SPEC 17.4).
 */
export async function requireHotel(hotelId: string, min: FullRole = "staff", area?: string) {
  const user = await requireUser();
  const role = await roleIn(user.id, hotelId);
  if (!canAccess(role, min, area)) notFound();
  const hotel = await getHotelById(hotelId);
  if (!hotel) notFound();
  return { user, role: role!, hotel, actor: `user:${user.id}` };
}
