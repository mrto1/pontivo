import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "../db/client";
import { hotelModules } from "../db/schema";
import { isOn, MODULES, moduleDef, switchProblem, type ModuleRow } from "../domain/modules";
import { audit } from "./audit";

export class ModuleError extends Error {}

export async function moduleRows(hotelId: string): Promise<ModuleRow[]> {
  return (await db().select({ module: hotelModules.module, enabled: hotelModules.enabled }).from(hotelModules).where(eq(hotelModules.hotelId, hotelId)));
}

export async function moduleOn(hotelId: string, key: string): Promise<boolean> {
  return isOn(await moduleRows(hotelId), key);
}

/** Für Seiten: ausgeschaltetes Modul → 404, auch wenn jemand die Adresse kennt */
export async function requireModule(hotelId: string, key: string): Promise<void> {
  if (!(await moduleOn(hotelId, key))) notFound();
}

export async function setModule(hotelId: string, key: string, on: boolean, actor: string): Promise<void> {
  if (!moduleDef(key)) throw new ModuleError("Unbekannte Funktion.");
  await db().transaction(async (tx) => {
    const rows = await tx.select({ module: hotelModules.module, enabled: hotelModules.enabled }).from(hotelModules).where(eq(hotelModules.hotelId, hotelId)).for("update");
    const problem = switchProblem(rows, key, on);
    if (problem) throw new ModuleError(problem);
    await tx.insert(hotelModules).values({ hotelId, module: key, enabled: on })
      .onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: on } });
    await audit(tx, { hotelId, actor, action: `module.${key}.${on ? "on" : "off"}`, entity: "hotel", entityId: hotelId, details: {} });
  });
}

export const listModules = () => MODULES;
