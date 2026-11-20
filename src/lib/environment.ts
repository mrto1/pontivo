/** Testumgebung (int): Schutz vor echtem Mailversand */
export type MailMsg = { from: string; to: string; subject: string; html: string; text: string };

/** Mit MAIL_REDIRECT_TO gesetzt geht jede Mail an diese Adresse; der ursprüngliche Empfänger steht im Betreff und im Text. */
export function applyMailGuard<M extends MailMsg>(msg: M, redirectTo: string | undefined): M {
  if (!redirectTo || msg.to.toLowerCase() === redirectTo.toLowerCase()) return msg;
  const note = `[Testumgebung] Ursprünglicher Empfänger: ${msg.to}`;
  return {
    ...msg,
    to: redirectTo,
    subject: `[int → ${msg.to}] ${msg.subject}`,
    text: `${note}\n\n${msg.text}`,
    html: `<p style="background:#fff3cd;padding:8px;border-radius:6px;font:13px sans-serif">${note.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>${msg.html}`,
  };
}
