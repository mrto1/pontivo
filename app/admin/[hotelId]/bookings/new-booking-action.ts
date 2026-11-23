"use server";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { bookingErrorText, createAdminBooking } from "@/src/services/admin-bookings";
import { BookingError } from "@/src/services/bookings";

export async function createBookingAction(formData: FormData) {
  const hotelId = String(formData.get("hotelId"));
  const { hotel, actor } = await requireHotel(hotelId, "staff", "bookings");
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const [roomTypeId, ratePlanId] = s("offer").split("|");
  const children = Number(s("children") || 0);
  const ages = s("ages") ? s("ages").split(/[,;\s]+/).filter(Boolean).map(Number) : [];
  // Weitere Zimmer (SPEC 19.6): bis zu zwei mit eigener Belegung
  const extraRooms = [2, 3].filter((i) => s(`offer${i}`)).map((i) => {
    const [rt, rp] = s(`offer${i}`).split("|");
    return { roomTypeId: rt, ratePlanId: rp, adults: Number(s(`adults${i}`) || 1), children: Number(s(`children${i}`) || 0), childrenAges: s(`ages${i}`) ? s(`ages${i}`).split(/[,;\s]+/).filter(Boolean).map(Number) : [] };
  });
  let target = "";
  try {
    const b = await createAdminBooking(hotel, {
      extraRooms,
      roomTypeId, ratePlanId, checkin: s("checkin"), checkout: s("checkout"), adults: Number(s("adults") || 1), children, childrenAges: ages,
      guest: { firstName: s("firstName"), lastName: s("lastName"), email: s("email"), phone: s("phone") || undefined, language: (s("language") || "de") as "de", notes: s("notes") || undefined },
      notifyGuest: formData.get("notify") === "on",
    }, actor);
    target = `/admin/${hotelId}/bookings/${b.id}?msg=${encodeURIComponent("Buchung erfasst")}`;
  } catch (e) {
    const msg = e instanceof BookingError ? bookingErrorText(e.code) : e instanceof ZodError ? e.issues.map((i) => i.message).join(", ") : `Fehler: ${(e as Error).message}`;
    const keep = new URLSearchParams();
    for (const k of ["offer", "offer2", "adults2", "children2", "ages2", "offer3", "adults3", "children3", "ages3", "checkin", "checkout", "adults", "children", "ages", "firstName", "lastName", "email", "phone", "language", "notes"]) if (s(k)) keep.set(k, s(k));
    keep.set("msg", msg);
    keep.set("neu", "1");
    target = `/admin/${hotelId}/bookings?${keep}`;
  }
  redirect(target);
}

