import { redirect } from "next/navigation";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotel } from "@/src/auth/guard";
import { adminNav, allPages } from "@/src/admin/nav";
import { hiddenNavKeys } from "@/src/domain/modules";
import { GUIDE_ROLE_LABEL, guideRole, progress, tasksFor } from "@/src/domain/guide";
import { moduleRows } from "@/src/services/modules";
import { doneTasks, setTask } from "@/src/services/guide";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "staff", "firstweek");
  await setTask(c.hotel.id, c.user.id, c.role, s(f, "task"), f.get("done") === "1");
  redirect(`/admin/${c.hotel.id}/erste-woche`);
}

export default async function FirstWeekPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, user, role } = await requireHotel(hotelId, "staff", "firstweek");
  const pages = allPages(adminNav(hotel, hiddenNavKeys(await moduleRows(hotel.id))));
  const href = new Map(pages.map((p) => [p.key, p.href]));
  href.set("konto", `/admin/${hotel.id}/konto`);
  const tasks = tasksFor(role, new Set(href.keys()));
  const done = await doneTasks(hotel.id, user.id);
  const p = progress(tasks, done);
  return (
    <div className="stack">
      <h1>Erste Woche: {GUIDE_ROLE_LABEL[guideRole(role)]}<InfoTip>{p.done} von {p.total} erledigt. Jede Aufgabe führt direkt an die richtige Stelle. Unter «Hilfe» steht, was jede Funktion kann.</InfoTip></h1>
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {tasks.map((t) => (
          <li key={t.key} className="card">
            <form action={toggle} style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
              <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="task" value={t.key} /><input type="hidden" name="done" value={done.has(t.key) ? "0" : "1"} />
              <div>
                <strong style={done.has(t.key) ? { textDecoration: "line-through" } : undefined}>{t.title}</strong>
                <p className="small muted" style={{ margin: "4px 0 0" }}>{t.hint}</p>
                <p className="small" style={{ margin: "4px 0 0" }}><a href={href.get(t.area)}>Öffnen</a></p>
              </div>
              <button className={`btn small ${done.has(t.key) ? "secondary" : ""}`}>{done.has(t.key) ? "Zurücknehmen" : "Erledigt"}</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
