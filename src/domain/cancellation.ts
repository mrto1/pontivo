import { bpsOf } from "./money";
import { zonedToUtc, type Day } from "./dates";

/** SPEC 5.7 */
export type CancelInput = {
  totalRappen: number;
  roomsTotalRappen: number;
  freeCancelHours: number | null;
  cancelFeeBps: number;
  checkin: Day;
  checkinTime: string; // 'HH:mm[:ss]'
  timezone: string;
  now: Date;
  byHotel?: boolean;
};

export type CancelQuote = {
  refundRappen: number;
  feeRappen: number;
  free: boolean;
  deadline: Date | null;
};

export function cancellationDeadline(i: Pick<CancelInput, "freeCancelHours" | "checkin" | "checkinTime" | "timezone">): Date | null {
  if (i.freeCancelHours === null) return null;
  const checkinAt = zonedToUtc(i.checkin, i.checkinTime, i.timezone);
  return new Date(checkinAt.getTime() - i.freeCancelHours * 3600_000);
}

export function quoteCancellation(i: CancelInput): CancelQuote {
  const deadline = cancellationDeadline(i);
  if (i.byHotel) return { refundRappen: i.totalRappen, feeRappen: 0, free: true, deadline };
  if (deadline && i.now.getTime() <= deadline.getTime()) {
    return { refundRappen: i.totalRappen, feeRappen: 0, free: true, deadline };
  }
  const fee = Math.min(bpsOf(i.roomsTotalRappen, i.cancelFeeBps), i.totalRappen);
  return { refundRappen: i.totalRappen - fee, feeRappen: fee, free: false, deadline };
}

/** Stornoregel als Text in der Sprache des Gastes */
export function cancellationPolicyText(
  plan: { freeCancelHours: number | null; cancelFeeBps: number },
  lang: string,
): string {
  const pct = plan.cancelFeeBps / 100;
  const L = (lang in POLICY ? lang : "de") as keyof typeof POLICY;
  const T = POLICY[L];
  if (plan.freeCancelHours === null) return pct >= 100 ? T.nonRefundable : T.fee(pct);
  const h = plan.freeCancelHours;
  const when = h % 24 === 0 ? T.days(h / 24) : `${h} h`;
  return T.free(when, pct);
}

const POLICY = {
  de: {
    nonRefundable: "Nicht stornierbar. Bei Stornierung wird der Zimmerpreis nicht erstattet (Kurtaxe schon).",
    fee: (p: number) => `Bei Stornierung werden ${p} % des Zimmerpreises verrechnet.`,
    days: (d: number) => `${d} Tag(e)`,
    free: (w: string, p: number) => `Kostenlos stornierbar bis ${w} vor Anreise (Check-in-Zeit). Danach ${p} % des Zimmerpreises.`,
  },
  en: {
    nonRefundable: "Non-refundable. The room price is not refunded on cancellation (tourist tax is).",
    fee: (p: number) => `On cancellation, ${p}% of the room price is charged.`,
    days: (d: number) => `${d} day(s)`,
    free: (w: string, p: number) => `Free cancellation until ${w} before arrival (check-in time). After that ${p}% of the room price.`,
  },
  fr: {
    nonRefundable: "Non remboursable. En cas d'annulation, le prix de la chambre n'est pas remboursé (la taxe de séjour l'est).",
    fee: (p: number) => `En cas d'annulation, ${p} % du prix de la chambre est facturé.`,
    days: (d: number) => `${d} jour(s)`,
    free: (w: string, p: number) => `Annulation gratuite jusqu'à ${w} avant l'arrivée (heure d'arrivée). Ensuite, ${p} % du prix de la chambre.`,
  },
  it: {
    nonRefundable: "Non rimborsabile. In caso di annullamento il prezzo della camera non viene rimborsato (la tassa di soggiorno sì).",
    fee: (p: number) => `In caso di annullamento viene addebitato il ${p} % del prezzo della camera.`,
    days: (d: number) => `${d} giorno/i`,
    free: (w: string, p: number) => `Annullamento gratuito fino a ${w} prima dell'arrivo (orario di check-in). Dopo, ${p} % del prezzo della camera.`,
  },
  nl: {
    nonRefundable: "Niet annuleerbaar. Bij annulering wordt de kamerprijs niet terugbetaald (de toeristenbelasting wel).",
    fee: (p: number) => `Bij annulering wordt ${p}% van de kamerprijs in rekening gebracht.`,
    days: (d: number) => `${d} dag(en)`,
    free: (w: string, p: number) => `Gratis annuleren tot ${w} voor aankomst (check-in-tijd). Daarna ${p}% van de kamerprijs.`,
  },
};
