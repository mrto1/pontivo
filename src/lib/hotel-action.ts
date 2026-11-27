import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel, requireHotelModule } from "../auth/guard";
import type { FullRole } from "../domain/roles";
import { UserError } from "../domain/errors";
import { s } from "./form";

/** Zugriff auf den Betrieb in einer Server Action (Benutzer, Rolle, Betrieb, `actor` fürs Protokoll) */
export type HotelCtx = Awaited<ReturnType<typeof requireHotel>>;

/** Ergebnis einer Aktion: Erfolgsmeldung, eigenes Ziel `{ to }` oder nichts (dann gilt `ok`) */
export type ActionResult = string | { to: string } | void | undefined;

export interface ActionOptions {
  /** Seite unter /admin/<id>/, z. B. "direktbuchung" oder "restaurant/artikel"; "" = Übersicht */
  page: string | ((c: HotelCtx) => string);
  /** Mindestrolle (Standard: staff) */
  role?: FullRole;
  /** Menübereich für eingeschränkte Rollen (siehe requireHotel) */
  area?: string;
  /** Funktion (Modul), die eingeschaltet sein muss */
  module?: string;
  /** Erfolgsmeldung, wenn die Aktion keinen Text liefert */
  ok?: string;
  /** Anker nach der Rückkehr, z. B. "#vorteile" */
  anchor?: string;
  /** Suchparameter, die immer mitgehen (z. B. Reiter) */
  keep?: Record<string, string>;
  /** Suchparameter nur bei einem Fehler: die Seitenleiste bleibt offen, z. B. { e: id } */
  reopen?: Record<string, string>;
  /** Vorsatz vor Fehlermeldungen (Standard «Nicht gespeichert») */
  fail?: string;
}

/** Meldung für den Benutzer, wenn der Fehler eine hat (Eingabe- oder Fachfehler); sonst null = Programmfehler */
export function userErrorText(e: unknown): string | null {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(", ");
  if (e instanceof UserError) return e.message;
  return null;
}

/** Adresse einer Admin-Seite mit Suchparametern (leere Werte fallen weg) und Anker */
export function adminHref(hotelId: string, page: string, params: Record<string, string | undefined> = {}, anchor = ""): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return `/admin/${hotelId}${page ? `/${page.replace(/^\/+/, "")}` : ""}${qs ? `?${qs}` : ""}${anchor}`;
}

/**
 * Gemeinsamer Rahmen für Formular-Aktionen im Admin: Zugriff prüfen (Betrieb aus dem Feld `hotelId`, Rolle, Modul),
 * Aktion ausführen, zurück zur Seite mit Meldung (`?msg=`). Fach- und Eingabefehler erscheinen als Meldung,
 * jeder andere Fehler bleibt ein Fehler (wird protokolliert, nicht dem Benutzer gezeigt).
 */
export async function hotelAction(f: FormData, o: ActionOptions, fn: (c: HotelCtx) => Promise<ActionResult> | ActionResult): Promise<never> {
  const id = s(f, "hotelId");
  const c = o.module ? await requireHotelModule(o.module, id, o.role ?? "staff", o.area) : await requireHotel(id, o.role ?? "staff", o.area);
  const page = typeof o.page === "function" ? o.page(c) : o.page;
  let r: ActionResult;
  try {
    r = await fn(c);
  } catch (e) {
    const text = userErrorText(e);
    if (text === null) throw e;
    redirect(adminHref(c.hotel.id, page, { ...o.keep, ...o.reopen, msg: `${o.fail ?? "Nicht gespeichert"}: ${text}` }, o.anchor));
  }
  if (r && typeof r === "object") redirect(r.to);
  redirect(adminHref(c.hotel.id, page, { ...o.keep, msg: r || o.ok || "Gespeichert." }, o.anchor));
}
