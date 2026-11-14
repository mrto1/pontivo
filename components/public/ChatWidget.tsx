"use client";

import { useRef, useState } from "react";
import type { ChatText } from "@/src/i18n/chat";

type Msg = { role: "user" | "assistant"; content: string };
type Card = { title: string; body: string };
type Offer = { room: string; plan: string; checkin: string; checkout: string; nights: number; total: string; cancellation: string; href: string };

/** KI-Chat auf der Hotel-Website und auf der Buchungsseite (SPEC 14b). Der Verlauf bleibt nur im Browser, nichts wird gespeichert. */
export function ChatWidget({ hotel, locale, token, text }: { hotel: string; locale: string; token?: string; text: ChatText }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [offerForward, setOfferForward] = useState(false);
  const [fwd, setFwd] = useState<"idle" | "form" | "done" | "fail">("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const scroll = () => setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 30);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    scroll();
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ hotel, session, messages: next, lang: locale, token }),
      });
      const j = (await r.json()) as { status: string; reply?: string; session?: string; forward?: boolean; arrival?: boolean; cards?: Offer[] };
      if (j.session) setSession(j.session);
      setMsgs([...next, { role: "assistant", content: j.reply ?? text.error }]);
      if (j.status === "paused" || j.forward) setOfferForward(true);
      if (j.cards?.length) setOffers((o) => [...o, ...j.cards!]);
      if (j.arrival && token) await showArrival();
    } catch {
      setMsgs([...next, { role: "assistant", content: text.error }]);
    } finally {
      setBusy(false);
      scroll();
    }
  }

  /** Ankunftsinfos kommen direkt vom Server (nicht vom KI-Modell) und werden als feste Karte gezeigt */
  async function showArrival() {
    try {
      const r = await fetch("/api/chat/arrival", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, lang: locale }) });
      const j = (await r.json()) as { status: string; text?: string };
      setCards((c) => [...c, { title: text.arrivalTitle, body: j.status === "ok" && j.text ? j.text : text.arrivalNone }]);
    } catch {
      setCards((c) => [...c, { title: text.arrivalTitle, body: text.error }]);
    }
  }

  async function forward(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await fetch("/api/chat/forward", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ hotel, name, email, transcript: msgs, lang: locale }),
      });
      setFwd(r.ok ? "done" : "fail");
    } catch {
      setFwd("fail");
    }
  }

  if (!open) {
    return <button type="button" className="chat-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">{text.open}</button>;
  }
  return (
    <section className="chat-panel" role="dialog" aria-label={text.title}>
      <header className="chat-head">
        <strong>{text.title}</strong>
        <button type="button" className="chat-x" onClick={() => setOpen(false)} aria-label={text.close}>×</button>
      </header>
      <div className="chat-body" aria-live="polite">
        <p className="chat-msg bot">{text.hello}</p>
        {msgs.map((m, i) => <p key={i} className={`chat-msg ${m.role === "user" ? "me" : "bot"}`}>{m.content}</p>)}
        {cards.map((c, i) => <div key={i} className="chat-card"><strong>{c.title}</strong><p>{c.body}</p></div>)}
        {offers.map((o, i) => (
          <div key={i} className="chat-card">
            <strong>{o.room} · {o.plan}</strong>
            <p>{o.checkin} – {o.checkout} · {o.nights} {text.offerNights}<br /><strong>{o.total}</strong><br /><small>{o.cancellation}</small></p>
            <a className="btn" href={o.href}>{text.offerCta}</a>
            <p><small>{text.offerHint}</small></p>
          </div>
        ))}
        {busy ? <p className="chat-msg bot chat-wait">{text.thinking}</p> : null}
        {offerForward && fwd === "idle" ? <button type="button" className="chat-link" onClick={() => setFwd("form")}>{text.forward}</button> : null}
        {fwd === "form" || fwd === "fail" ? (
          <form className="chat-forward" onSubmit={forward}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={text.forwardName} required maxLength={120} autoComplete="name" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={text.forwardEmail} required maxLength={200} autoComplete="email" />
            {fwd === "fail" ? <small className="chat-err">{text.forwardFail}</small> : null}
            <button type="submit" className="btn">{text.forwardSend}</button>
          </form>
        ) : null}
        {fwd === "done" ? <p className="chat-msg bot">{text.forwardDone}</p> : null}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={text.placeholder} maxLength={500} aria-label={text.placeholder} />
        <button type="submit" className="btn" disabled={busy || !input.trim()}>{text.send}</button>
      </form>
      <small className="chat-note">{text.notice}</small>
    </section>
  );
}
