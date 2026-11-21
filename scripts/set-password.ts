/**
 * Passwort setzen (Betreiber). Aufruf im App-Container:
 *   node --import tsx scripts/set-password.ts du@pontivo.ch "NeuesPasswort"
 *   node --import tsx scripts/set-password.ts --alle-test "testtest"     (nur auf int: setzt es für ALLE Konten ohne Passwort)
 * «--alle-test» ist nur erlaubt, wenn ENVIRONMENT_LABEL=int oder dev gesetzt ist (nie auf der Produktion).
 */
import { isNull } from "drizzle-orm";
import { closeDb, db } from "../src/db/client";
import { users } from "../src/db/schema";
import { hashPassword, passwordProblem } from "../src/auth/password";
import { findUserByEmail } from "../src/services/platform-admin";
import { setPasswordUnchecked } from "../src/services/password";

async function main() {
  const [who, pw] = process.argv.slice(2);
  if (!who || !pw) { console.error('Aufruf: node --import tsx scripts/set-password.ts du@pontivo.ch "Passwort"  |  --alle-test "Passwort"'); process.exit(1); }
  const problem = passwordProblem(pw);
  if (problem) { console.error(problem); process.exit(1); }
  if (who === "--alle-test") {
    const label = process.env.ENVIRONMENT_LABEL ?? "";
    if (!["int", "dev"].includes(label)) { console.error(`Verweigert: --alle-test gibt es nur mit ENVIRONMENT_LABEL=int oder dev (hier: «${label || "leer"}»).`); process.exit(1); }
    const hash = await hashPassword(pw);
    const r = await db().update(users).set({ passwordHash: hash }).where(isNull(users.passwordHash)).returning({ email: users.email });
    console.log(`Passwort gesetzt für ${r.length} Konten ohne Passwort.`);
    return;
  }
  const u = await findUserByEmail(who);
  if (!u) { console.error("Kein Konto mit dieser E-Mail-Adresse."); process.exit(1); }
  await setPasswordUnchecked(u.id, pw);
  console.log(`Passwort gesetzt für ${who}.`);
}
main().then(() => closeDb(), async (e) => { console.error(e); await closeDb(); process.exit(1); });
