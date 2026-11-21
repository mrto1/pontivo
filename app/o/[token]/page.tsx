import { Notice } from "@/components/admin/Notice";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { resources } from "@/src/db/schema";
import { acceptOffer, declineOffer, OfferError, offerByToken } from "@/src/services/offers";
import { offerOpen } from "@/src/domain/offers";
import { todayIn } from "@/src/domain/dates";
import { OfferSheet } from "@/components/offers/OfferSheet";
import { PrintButton } from "@/components/public/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

async function decide(f: FormData) {
  "use server";
  const token = String(f.get("token"));
  const note = String(f.get("note") ?? "");
  let msg = "";
  try {
    if (f.get("what") === "accept") { await acceptOffer(token, note); msg = "Vielen Dank, Sie haben das Angebot angenommen."; }
    else { await declineOffer(token, note); msg = "Das Angebot wurde abgelehnt."; }
  } catch (e) {
    if (!(e instanceof OfferError)) throw e;
    msg = `Nicht möglich: ${e.message}`;
  }
  redirect(`/o/${token}?msg=${encodeURIComponent(msg)}`);
}

/** Öffentliche Angebotsseite (Link aus der Mail): ansehen, als PDF speichern, zusagen oder ablehnen. */
export default async function OfferPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const d = await offerByToken(token);
  if (!d) notFound();
  const { offer, lines, hotel } = d;
  const open = offerOpen(offer, todayIn(hotel.timezone));
  const names: Record<string, string> = {};
  for (const l of lines) if (l.resourceId && !names[l.resourceId]) {
    const [r] = await db().select({ name: resources.name }).from(resources).where(and(eq(resources.id, l.resourceId), eq(resources.hotelId, hotel.id)));
    if (r) names[l.resourceId] = r.name;
  }
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }} className="stack">
      {sp.msg ? <Notice text={sp.msg} className="no-print" /> : null}
      <OfferSheet hotel={hotel} offer={offer} lines={lines} resourceNames={names} />
      <div className="no-print stack">
        <div><PrintButton label="Als PDF speichern / drucken" /></div>
        {offer.status === "accepted" ? <p className="notice">Sie haben dieses Angebot angenommen. Das Hotel meldet sich bei Ihnen.</p> : null}
        {offer.status === "declined" ? <p className="notice warn">Dieses Angebot wurde abgelehnt.</p> : null}
        {offer.status === "sent" && !open ? <p className="notice warn">Dieses Angebot ist abgelaufen. Bitte melden Sie sich bei {hotel.name} ({hotel.contactEmail}).</p> : null}
        {open ? (
          <form action={decide} className="card stack">
            <input type="hidden" name="token" value={token} />
            <label>Nachricht an das Hotel (optional)<textarea name="note" rows={3} maxLength={1000} /></label>
            <p className="small muted">Mit der Zusage reservieren Sie die genannten Räume und Zeiten verbindlich. Die Rechnung erhalten Sie vom Hotel.</p>
            <div className="row">
              <button className="btn" name="what" value="accept">Angebot annehmen</button>
              <button className="btn secondary" name="what" value="decline">Ablehnen</button>
            </div>
          </form>
        ) : null}
      </div>
    </main>
  );
}
