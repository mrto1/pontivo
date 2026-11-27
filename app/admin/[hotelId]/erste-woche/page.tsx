import { redirect } from "next/navigation";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotel } from "@/src/auth/guard";
import { GUIDE_ROLE_LABEL, guideRole, progress, tasksFor } from "@/src/domain/guide";
import { helpContext } from "@/src/services/help";
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
  // Menüs wie in der Navigation (Unterkunft und Gastronomie, nach Rolle), damit auch Restaurant-Aufgaben erscheinen
  const href = new Map((await helpContext(hotel, role)).pages);
  href.set("konto", `/admin/${hotel.id}/konto`);
  const tasks = tasksFor(role, new Set(href.keys()));
  const done = await doneTasks(hotel.id, user.id);
  const p = progress(tasks, done);
  return (
    <div className="stack">
      <h1>Erste Woche: {GUIDE_ROLE_LABEL[guideRole(role)]}<InfoTip>{p.done} von {p.total} erledigt. Jede Aufgabe führt direkt an die richtige Stelle. Unter «Hilfe» steht, was jede Funktion kann.</InfoTip></h1>
      <ul className="stack u-ls-none u-p-0">
        {tasks.map((t) => (
          <li key={t.key} className="card">
            <form className="u-d-flex u-gap-12px u-ai-flex-start u-jc-space-between" action={toggle}>
              <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="task" value={t.key} /><input type="hidden" name="done" value={done.has(t.key) ? "0" : "1"} />
              <div>
                <strong style={done.has(t.key) ? { textDecoration: "line-through" } : undefined}>{t.title}</strong>
                <p className="small muted m-4-0-0">{t.hint}</p>
                <p className="small m-4-0-0"><a href={href.get(t.area)}>Öffnen</a></p>
              </div>
              <button className={`btn small ${done.has(t.key) ? "secondary" : ""}`}>{done.has(t.key) ? "Zurücknehmen" : "Erledigt"}</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
