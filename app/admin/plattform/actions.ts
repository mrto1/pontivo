"use server";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/src/auth/guard";
import { addPlatformAdmin, deleteHotelCascade, deleteUserAccount, platformOverview, removePlatformAdmin, resetUserSecurity } from "@/src/services/platform-admin";
import { getHotelById } from "@/src/services/hotels";
import { addMember, removeMember, setHotelStatus } from "@/src/services/settings";
import { requestLoginLink } from "@/src/auth/session";
import type { Role } from "@/src/domain/roles";
import { PlatformSettingsError, savePlatformBilling, savePlatformVat } from "@/src/services/platform-settings";
import { importPlatformCamt, markChargePaid, remindNow, resendQrInvoice, retryCharge, processCharges } from "@/src/services/billing";
import { formatChf } from "@/src/domain/money";
import { importSchoolHolidays } from "@/src/services/holidays";

// Alle Aktionen der Plattform-Verwaltung. Jede Seite schickt in `to` ihren eigenen Pfad mit; danach geht es dorthin zurück.
const PAGES = ["/admin/plattform/betriebe", "/admin/plattform/benutzer", "/admin/plattform/rechnungen", "/admin/plattform/mwst", "/admin/plattform/zahlungsverbindung", "/admin/plattform/admins", "/admin/plattform/schulferien"];
const target = (f: FormData) => { const t = String(f.get("to") ?? ""); return PAGES.includes(t) ? t : "/admin/plattform"; };
const go = (to: string, msg: string, key: "done" | "error" = "done"): never => redirect(`${to}?${key}=${encodeURIComponent(msg)}`);

export async function hotelStatus(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const hotel = await getHotelById(String(f.get("id") ?? ""));
  const status = String(f.get("status"));
  if (!hotel || !["live", "paused"].includes(status)) go(to, "Betrieb nicht gefunden", "error");
  try { await setHotelStatus(hotel!, status as "live" | "paused", `user:${admin.id}`); } catch (e) { go(to, (e as Error).message, "error"); }
  go(to, `«${hotel!.name}»: ${status === "live" ? "wieder online" : "pausiert"}`);
}

export async function saveVat(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const on = f.get("liable") === "on";
  try {
    await savePlatformVat({ liableFrom: on ? String(f.get("from") ?? "") : null, bps: Math.round(Number(String(f.get("rate") ?? "8.1").replace(",", ".")) * 100), number: String(f.get("number") ?? "") }, `user:${admin.id}`);
  } catch (e) { go(to, (e as Error).message, "error"); }
  go(to, on ? "MWST-Pflicht gespeichert: gilt für Rechnungen ab dem eingetragenen Datum (Leistungsmonat)" : "MWST-Pflicht ausgeschaltet: neue Rechnungen ohne MWST");
}

export async function importSchool(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const r = await importSchoolHolidays(String(f.get("csv") ?? ""), `user:${admin.id}`);
  if (!r.imported) go(to, r.errors.slice(0, 3).join(" · ") || "Keine Zeilen erkannt", "error");
  go(to, `${r.imported} Schulferien-Einträge importiert${r.errors.length ? `, ${r.errors.length} Zeilen übersprungen (${r.errors.slice(0, 2).join("; ")})` : ""}`);
}

export async function adminAdd(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  try {
    const r = await addPlatformAdmin(String(f.get("email") ?? ""), String(f.get("name") ?? ""), `user:${admin.id}`);
    const sent = await requestLoginLink(r.email);
    go(to, `${r.email} ist jetzt Plattform-Admin${sent ? " (Login-Link per E-Mail gesendet)" : " (Login unter /mypontivo/login)"}`);
  } catch (e) {
    // redirect() wirft; nur echte Fehler weitergeben
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(to, (e as Error).message, "error");
  }
}

export async function adminRemove(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  try { await removePlatformAdmin(String(f.get("id")), admin.id, `user:${admin.id}`); } catch (e) { go(to, (e as Error).message, "error"); }
  go(to, "Plattform-Admin-Recht entzogen (das Konto bleibt bestehen)");
}

export async function retryInvoice(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const ok = await retryCharge(String(f.get("id")), `user:${admin.id}`);
  if (ok) await processCharges();
  go(to, ok ? "Belastung nochmals versucht" : "Nichts zu wiederholen", ok ? "done" : "error");
}

export async function memberAdd(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  try { await addMember(String(f.get("hotelId")), String(f.get("email")), String(f.get("role")) as Role, `user:${admin.id}`); } catch (e) { go(to, (e as Error).message, "error"); }
  go(to, "Mitglied gespeichert (der Zugang erfolgt über die Anmeldung mit dieser E-Mail)");
}

export async function memberRemove(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  await removeMember(String(f.get("hotelId")), String(f.get("userId")), `user:${admin.id}`);
  go(to, "Mitgliedschaft entfernt");
}

export async function securityReset(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  await resetUserSecurity(String(f.get("id")), `user:${admin.id}`);
  go(to, "Sicherheit zurückgesetzt: Passkeys, Authenticator und Wiederherstellungscodes entfernt");
}

export async function sendLink(f: FormData) {
  const to = target(f);
  await requirePlatformAdmin();
  const link = await requestLoginLink(String(f.get("email")));
  go(to, link ? "Login-Link per E-Mail gesendet" : "Kein Link möglich (Konto unbekannt oder «Nur Passkey» aktiv; zuerst Sicherheit zurücksetzen)", link ? "done" : "error");
}

export async function removeHotel(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const id = String(f.get("id") ?? "");
  const { hotels } = await platformOverview();
  const h = hotels.find((x) => x.id === id);
  if (!h) redirect(to);
  // Löschen nur, wenn der Name genau eingetippt wurde
  if (String(f.get("confirm") ?? "").trim() !== h.name) redirect(`${to}?error=confirm`);
  await deleteHotelCascade(id, `user:${admin.id}`);
  go(to, `Betrieb «${h.name}» gelöscht`);
}

export async function removeUser(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const id = String(f.get("id") ?? "");
  const { users } = await platformOverview();
  const u = users.find((x) => x.id === id);
  if (!u || u.isPlatformAdmin || u.id === admin.id) redirect(`${to}?error=user`);
  if (String(f.get("confirm") ?? "").trim().toLowerCase() !== u.email.toLowerCase()) redirect(`${to}?error=confirm`);
  await deleteUserAccount(id, `user:${admin.id}`);
  go(to, `Benutzer ${u.email} gelöscht`);
}

// ---------------------------------------------------------------- QR-Rechnungen der Plattform (SPEC 20.6)

export async function saveBilling(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  try {
    await savePlatformBilling({ iban: String(f.get("iban") ?? ""), paymentDays: Number(f.get("days") ?? 30) }, `user:${admin.id}`);
  } catch (e) { if (!(e instanceof PlatformSettingsError)) throw e; go(to, e.message, "error"); }
  go(to, "Zahlungsverbindung gespeichert: gilt für neue und offene QR-Rechnungen");
}

export async function invoicePaid(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const ok = await markChargePaid(String(f.get("id") ?? ""), { paidOn: String(f.get("paidOn") ?? ""), note: String(f.get("note") ?? "") }, `user:${admin.id}`);
  go(to, ok ? "Zahlung erfasst" : "Diese Rechnung ist nicht mehr offen", ok ? "done" : "error");
}

export async function invoiceRemind(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const level = await remindNow(String(f.get("id") ?? ""), `user:${admin.id}`);
  go(to, level ? `Mahnstufe ${level} gesendet` : "Keine weitere Mahnstufe möglich", level ? "done" : "error");
}

export async function invoiceResend(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const ok = await resendQrInvoice(String(f.get("id") ?? ""), `user:${admin.id}`);
  go(to, ok ? "Rechnung erneut gesendet" : "Diese Rechnung ist nicht mehr offen", ok ? "done" : "error");
}

export async function camtImport(f: FormData) {
  const to = target(f);
  const admin = await requirePlatformAdmin();
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) go(to, "Bitte eine camt.054-Datei wählen", "error");
  if ((file as File).size > 5_000_000) go(to, "Die Datei ist zu gross (höchstens 5 MB)", "error");
  const r = await importPlatformCamt(await (file as File).text(), `user:${admin.id}`);
  const parts = [`${r.entries} Gutschriften gelesen`, `${r.matched.length} Rechnungen bezahlt${r.matched.length ? ` (${r.matched.map((m) => m.invoiceNo).join(", ")})` : ""}`];
  if (r.duplicates) parts.push(`${r.duplicates} schon früher verbucht`);
  if (r.unmatched.length) parts.push(`nicht zugeordnet: ${r.unmatched.slice(0, 5).map((u) => `${u.bookedOn} ${formatChf(u.amountRappen)} (${u.why})`).join("; ")}`);
  go(to, parts.join(" · "), r.unmatched.length && !r.matched.length ? "error" : "done");
}
