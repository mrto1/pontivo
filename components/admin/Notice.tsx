import { msgTone } from "@/src/domain/msg-tone";

/** Rückmeldung nach einer Aktion: grün bei Erfolg, rot bei Fehler (`src/domain/msg-tone.ts`) */
export function Notice({ text, className = "" }: { text: string; className?: string }) {
  const err = msgTone(text) === "error";
  return <p className={`notice${err ? " error" : ""}${className ? ` ${className}` : ""}`} role={err ? "alert" : "status"}>{text}</p>;
}
