/**
 * Hintergrund-Jobs mit pg-boss (SPEC 2): eigener Prozess `npm run worker`.
 * - holds:   abgelaufene Holds freigeben (jede Minute, SPEC 5.5)
 * - emails:  E-Mail-Outbox senden (jede Minute, SPEC 10)
 * - push:    Push-Mitteilungen an die Geräte der Mitarbeitenden senden (jede Minute)
 * - horizon: Verfügbarkeit/Preise auf 18 Monate auffüllen (täglich 03:15, SPEC 4)
 * - channex-feed:   Buchungen aus Channex holen (sofort per Webhook, zur Sicherheit alle 15 Minuten, SPEC 7.3)
 * - guests-checkin: Check-in-Links einreihen (Modul Gäste, alle 10 Minuten, SPEC 14.1)
 * - guests-purge:   abgelaufene Meldescheine löschen (täglich 02:30, SPEC 14.6)
 * - onboarding-reminders: Erinnerung an Gastgeber mit offener Einrichtung (täglich 09:20)
 * - billing-minimum: Mindestgebühr des Vormonats abrechnen und Fehlversuche wiederholen (täglich 07:10)
 * - channex-outbox: ARI an Channex senden (Schleife alle 6 Sekunden, SPEC 7.2)
 */
import { PgBoss } from "pg-boss";
import { env } from "../env";
import { expireHolds } from "../services/bookings";
import { sendDueEmails } from "../email/send";
import { extendHorizon } from "../services/inventory";
import { releaseDueGroups } from "../services/groups";
import { OutboxState, runOutboxOnce } from "../integrations/channex/outbox-worker";
import { pullFeed } from "../integrations/channex/feed";
import { enqueueCheckinLinks, purgeExpiredRegistrations } from "../services/guests";
import { onboardingReminders } from "../services/onboarding";
import { runMonthlyMinimum } from "../services/billing";
import { sendDuePushes } from "../push/service";
import { beat, runWatchdog } from "../services/monitor";
import { reconcilePayments } from "../services/reconcile";
import { syncDueFeeds } from "../services/ical";
import { balanceJob } from "../services/balance";
import { monthlyAccountingJob } from "../services/accounting";

const jobs: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: "holds", cron: "* * * * *", run: () => expireHolds() },
  { name: "emails", cron: "* * * * *", run: () => sendDueEmails() },
  { name: "push", cron: "* * * * *", run: () => sendDuePushes() },
  { name: "horizon", cron: "15 3 * * *", run: () => extendHorizon() },
  { name: "groups-release", cron: "5 4 * * *", run: () => releaseDueGroups() },
  { name: "channex-feed", cron: "*/15 * * * *", run: () => pullFeed() },
  { name: "guests-checkin", cron: "*/10 * * * *", run: () => enqueueCheckinLinks() },
  { name: "guests-purge", cron: "30 2 * * *", run: () => purgeExpiredRegistrations() },
  { name: "onboarding-reminders", cron: "20 9 * * *", run: () => onboardingReminders() },
  { name: "billing-minimum", cron: "10 7 * * *", run: () => runMonthlyMinimum() },
  { name: "ical-sync", cron: "*/15 * * * *", run: () => syncDueFeeds() },
  { name: "accounting-export", cron: "40 8 5 * *", run: () => monthlyAccountingJob() },
  { name: "balance", cron: "5 * * * *", run: () => balanceJob() },
  { name: "watchdog", cron: "*/10 * * * *", run: () => runWatchdog() },
  { name: "reconcile-payments", cron: "10 4 * * *", run: () => reconcilePayments() },
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
  // Lebenszeichen für /api/health?deep=1
  const heartbeat = setInterval(() => beat().catch((e) => console.error("[heartbeat]", e)), 60_000);
  beat().catch((e) => console.error("[heartbeat]", e));
  const stopOutbox = env().CHANNEX_API_KEY ? startOutboxLoop() : () => {};
  console.log("Worker läuft:", jobs.map((j) => `${j.name} (${j.cron})`).join(", "), env().CHANNEX_API_KEY ? "+ channex-outbox (6 s)" : "(Channex nicht konfiguriert)");
  const stop = async () => {
    clearInterval(heartbeat);
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
