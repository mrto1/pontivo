"use client";
import { useRouter } from "next/navigation";

// Datumsfeld: springt direkt zum gewählten Tag (auch weit voraus).
export default function CalendarJump({ from, days }: { from: string; days: number }) {
  const router = useRouter();
  return (
    <input
      type="date"
      className="cal-date"
      value={from}
      aria-label="Zu Datum springen"
      onChange={(e) => {
        if (e.target.value) router.push(`?from=${e.target.value}&days=${days}`);
      }}
    />
  );
}
