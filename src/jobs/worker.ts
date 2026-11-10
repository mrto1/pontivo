/**
 * Hintergrund-Jobs mit pg-boss (SPEC 2): eigener Prozess `npm run worker`.
 * - holds:   abgelaufene Holds freigeben (jede Minute, SPEC 5.5)
 * - emails:  E-Mail-Outbox senden (jede Minute, SPEC 10)
 * - horizon: Verfügbarkeit/Preise auf 18 Monate auffüllen (täglich 03:15, SPEC 4)
 * - channex-feed:   Buchungen aus Channex holen (alle 2 Minuten + sofort per Webhook, SPEC 7.3)
 * - guests-checkin: Check-in-Links einreihen (Modul Gäste, alle 10 Minuten, SPEC 14.1)
 * - guests-purge:   abgelaufene Meldescheine löschen (täglich 02:30, SPEC 14.6)
 * - channex-outbox: ARI an Channex senden (Schleife alle 6 Sekunden, SPEC 7.2)
 */
import { PgBoss } from "pg-boss";
import { env } from "../env";
import { expireHolds } from "../services/bookings";
import { sendDueEmails } from "../email/send";
import { extendHorizon } from "../services/inventory";
import { OutboxState, runOutboxOnce } from "../integrations/channex/outbox-worker";
import { pullFeed } from "../integrations/channex/feed";
import { enqueueCheckinLinks, purgeExpiredRegistrations } from "../services/guests";

const jobs: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: "holds", cron: "* * * * *", run: () => expireHolds() },
  { name: "emails", cron: "* * * * *", run: () => sendDueEmails() },
  { name: "horizon", cron: "15 3 * * *", run: () => extendHorizon() },
  { name: "channex-feed", cron: "*/2 * * * *", run: () => pullFeed() },
  { name: "guests-checkin", cron: "*/10 * * * *", run: () => enqueueCheckinLinks() },
  { name: "guests-purge", cron: "30 2 * * *", run: () => purgeExpiredRegistrations() },
];

/** channex-outbox: pg-boss kennt nur Minuten-Cron, darum eigene Schleife (nie zwei Durchläufe gleichzeitig) */
function startOutboxLoop() {
  const state = new OutboxState();
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await runOutboxOnce(state);
      if (r.requests) console.log("[job channex-outbox]", r);
    } catch (e) {
      console.error("[job channex-outbox]", e);
    }
    setTimeout(tick, 6000);
  };
  tick();
  return () => {
    stopped = true;
  };
}

async function main() {
  const boss = new PgBoss(env().DATABASE_URL);
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const j of jobs) {
    await boss.createQueue(j.name);
    await boss.schedule(j.name, j.cron, null, { tz: "Europe/Zurich" });
    await boss.work(j.name, async () => {
      const r = await j.run();
      if (r && (typeof r === "number" ? r > 0 : true)) console.log(`[job ${j.name}]`, r);
    });
  }
  const stopOutbox = env().CHANNEX_API_KEY ? startOutboxLoop() : () => {};
  console.log("Worker läuft:", jobs.map((j) => `${j.name} (${j.cron})`).join(", "), env().CHANNEX_API_KEY ? "+ channex-outbox (6 s)" : "(Channex nicht konfiguriert)");
  const stop = async () => {
    stopOutbox();
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
