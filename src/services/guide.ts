import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { onboardingTasks } from "../db/schema";
import { GUIDE, guideRole } from "../domain/guide";
import type { Role } from "../domain/roles";

/** Erledigte Aufgaben der Checkliste «Erste Woche» (je Person und Betrieb). Jede Abfrage nach hotel_id. */
export async function doneTasks(hotelId: string, userId: string): Promise<Set<string>> {
  const r = await db().select({ k: onboardingTasks.taskKey }).from(onboardingTasks).where(and(eq(onboardingTasks.hotelId, hotelId), eq(onboardingTasks.userId, userId)));
  return new Set(r.map((x) => x.k));
}

/** Aufgabe abhaken oder zurücknehmen; nur Aufgaben der eigenen Checkliste */
export async function setTask(hotelId: string, userId: string, role: Role, taskKey: string, done: boolean): Promise<boolean> {
  if (!GUIDE[guideRole(role)].some((t) => t.key === taskKey)) return false;
  if (done) await db().insert(onboardingTasks).values({ hotelId, userId, taskKey }).onConflictDoNothing();
  else await db().delete(onboardingTasks).where(and(eq(onboardingTasks.hotelId, hotelId), eq(onboardingTasks.userId, userId), eq(onboardingTasks.taskKey, taskKey)));
  return true;
}
