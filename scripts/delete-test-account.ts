/**
 * Testkonto samt Betrieb(en) löschen (nicht rückgängig). Komfortabler im Admin unter /plattform.
 *   node --import tsx scripts/delete-test-account.ts <email>          zeigt nur, was gelöscht würde
 *   node --import tsx scripts/delete-test-account.ts <email> --yes    löscht
 * Betriebe mit weiteren Mitgliedern bleiben; «live» nur mit --include-live; Plattform-Admins nie.
 */
import { closeDb } from "../src/db/client";
import { deleteHotelCascade, deleteUserAccount, findUserByEmail, soleHotelsOf } from "../src/services/platform-admin";

const [email, ...flags] = process.argv.slice(2);
const yes = flags.includes("--yes");
const includeLive = flags.includes("--include-live");
if (!email || !/@/.test(email)) {
  console.error("Aufruf: node --import tsx scripts/delete-test-account.ts <email> [--yes] [--include-live]");
  process.exit(1);
}

async function main() {
  const u = await findUserByEmail(email);
  if (!u) { console.log(`Kein Konto mit ${email}.`); return; }
  if (u.is_platform_admin) { console.error("Das ist ein Plattform-Admin. Das Skript löscht so ein Konto nicht."); process.exit(1); }
  const hotels = (await soleHotelsOf(u.id)).filter((h) => includeLive || h.status !== "live");
  console.log(`Konto: ${u.email}`);
  for (const h of hotels) console.log(`  Betrieb «${h.name}» (${h.status}): wird gelöscht`);
  if (!yes) { console.log("\nNichts gelöscht. Zum Löschen --yes anhängen."); return; }
  const total = new Map<string, number>();
  for (const h of hotels) for (const [t, n] of await deleteHotelCascade(h.id, "script")) total.set(t, (total.get(t) ?? 0) + n);
  for (const [t, n] of await deleteUserAccount(u.id, "script")) total.set(t, (total.get(t) ?? 0) + n);
  console.log("\nGelöscht:");
  for (const [t, n] of [...total].sort()) console.log(`  ${t}: ${n}`);
}
main().then(closeDb, async (e) => { console.error(e); await closeDb(); process.exit(1); });
