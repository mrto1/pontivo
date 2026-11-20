"use client";
import { useRouter } from "next/navigation";

/** Datums- oder Monatsfeld: springt direkt zum gewählten Zeitpunkt (auch weit voraus). Weitere Parameter bleiben erhalten. */
export default function PeriodJump({ kind = "date", value, param, keep = {}, label }: { kind?: "date" | "month"; value: string; param: string; keep?: Record<string, string>; label?: string }) {
  const router = useRouter();
  return (
    <input
      type={kind}
      className="cal-date"
      value={value}
      aria-label={label ?? (kind === "month" ? "Zu Monat springen" : "Zu Datum springen")}
      onChange={(e) => {
        if (!e.target.value) return;
        const q = new URLSearchParams({ ...keep, [param]: e.target.value });
        router.push(`?${q.toString()}`);
      }}
    />
  );
}
