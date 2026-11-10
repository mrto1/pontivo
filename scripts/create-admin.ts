/** Plattform-Admin anlegen (Produktion): node --import tsx scripts/create-admin.ts du@pontivo.ch "Vorname Name" */
import { createUser } from "../src/services/setup";
import { closeDb } from "../src/db/client";

const [email, name] = process.argv.slice(2);
if (!email || !/@/.test(email)) {
  console.error('Aufruf: node --import tsx scripts/create-admin.ts du@pontivo.ch "Vorname Name"');
  process.exit(1);
}
createUser(email, { name, platformAdmin: true }).then(
  async (u) => { console.log(`Plattform-Admin: ${u.email} – Login unter /admin/login`); await closeDb(); },
  (e) => { console.error(e); process.exit(1); },
);
