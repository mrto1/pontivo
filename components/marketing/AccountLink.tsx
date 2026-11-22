import { accountLink } from "@/src/services/account-link";

/** Kleiner Link oben auf den Plattform-Seiten: «Anmelden» oder, wenn angemeldet, «Zu <Betrieb>» (führt zur Verwaltung) */
export async function AccountLink() {
  if (process.env.STATIC_SITE === "1") return null;
  const a = await accountLink();
  return <a href={a ? "/admin" : "/admin/login"} className="small" style={{ float: "right", fontWeight: 600 }}>{a ? a.label : "Anmelden"}</a>;
}
