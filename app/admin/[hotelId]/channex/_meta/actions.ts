"use server";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import {
  activateMetaChannel,
  channelErrorText,
  deactivateMetaChannel,
  META_CHANNELS,
  parseMetaChannel,
  probeMetaChannel,
  removeMetaChannel,
  saveMetaMapping,
  type MetaChannel,
} from "@/src/integrations/channex/channels";

/** Gemeinsame Server Actions für Kanäle mit Hotel-ID (Booking.com, Expedia). Immer über requireHotel (Mandantentrennung). */
async function run(f: FormData, fn: (ctx: Awaited<ReturnType<typeof requireHotel>>, channel: MetaChannel) => Promise<string>) {
  const ctx = await requireHotel(String(f.get("hotelId")), "manager");
  const channel = parseMetaChannel(f.get("channel"));
  let msg: string;
  try {
    msg = await fn(ctx, channel);
  } catch (e) {
    msg = `Fehler: ${channelErrorText(e, META_CHANNELS[channel].label)}`;
  }
  redirect(`/admin/${ctx.hotel.id}/channex/${META_CHANNELS[channel].path}?msg=${encodeURIComponent(msg)}`);
}

export async function probeAction(f: FormData) {
  await run(f, async ({ hotel, actor }, channel) => {
    await probeMetaChannel(hotel, channel, String(f.get("externalHotelId") ?? ""), actor, {
      minStayType: f.get("minStayType") ? String(f.get("minStayType")) : undefined,
      bookingAmount: f.get("bookingAmount") ? String(f.get("bookingAmount")) : undefined,
    });
    return "Hotel-ID akzeptiert. Jetzt die Zimmer und Tarife zuordnen.";
  });
}

export async function mappingAction(f: FormData) {
  await run(f, async ({ hotel, actor }, channel) => {
    const sel: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith("map:") && v) sel[k.slice(4)] = String(v);
    await saveMetaMapping(hotel, channel, sel, actor);
    return "Zuordnung gespeichert";
  });
}

export async function activateAction(f: FormData) {
  await run(f, async ({ hotel, actor }, channel) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte bestätigen, dass Preise und Verfügbarkeit stimmen");
    const r = await activateMetaChannel(hotel, channel, actor);
    const label = META_CHANNELS[channel].label;
    return r.loaded
      ? `${label} ist verbunden. Bestehende Buchungen werden geladen.`
      : `${label} ist verbunden, aber bestehende Buchungen konnten nicht geladen werden (siehe Hinweis).`;
  });
}

export async function deactivateAction(f: FormData) {
  await run(f, async ({ hotel, actor }, channel) => {
    await deactivateMetaChannel(hotel, channel, actor);
    return `Verbindung pausiert. ${META_CHANNELS[channel].label} erhält keine Änderungen mehr.`;
  });
}

export async function removeAction(f: FormData) {
  await run(f, async ({ hotel, actor }, channel) => {
    if (f.get("confirm") !== "on") throw new Error("Bitte das Entfernen bestätigen");
    await removeMetaChannel(hotel, channel, actor);
    return "Verbindung entfernt";
  });
}
