"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/src/i18n/dict";
import { D } from "@/src/i18n/direct";
import { solvePow } from "./pow-client";

/** Warteliste bei «ausgebucht» (SPEC 19.29): E-Mail eintragen, einmalige Benachrichtigung */
export function WaitlistForm(props: { locale: Locale; hotelSlug: string; checkin: string; checkout: string; adults: number; children: number; ages: number[] }) {
  const m = D[props.locale];
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const f = new FormData(e.currentTarget);
    let pow = "";
    try { pow = await solvePow(); } catch { /* Server meldet den Fehler */ }
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pow, hotel: props.hotelSlug, email: f.get("email"), name: f.get("name") || undefined, language: props.locale, checkin: props.checkin, checkout: props.checkout, adults: props.adults, children: props.children, children_ages: props.ages }),
    }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }

  if (state === "done") return <p className="notice" role="status">{m.waitDone}</p>;
  return (
    <form onSubmit={submit} className="card stack waitlist-form">
      <h3 className="m0">{m.waitTitle}</h3>
      <p className="muted m0">{m.waitText}</p>
      <div className="form-grid">
        <div><label>{m.waitName}</label><input name="name" autoComplete="name" /></div>
        <div><label>{m.waitEmail}</label><input name="email" type="email" required autoComplete="email" /></div>
      </div>
      {state === "error" ? <p className="notice warn" role="alert">{m.waitError}</p> : null}
      <div><button className="btn" type="submit" disabled={state === "busy" || !ready}>{m.waitButton}</button></div>
      <p className="muted small m0">{m.waitNote}</p>
    </form>
  );
}
