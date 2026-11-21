/**
 * Hinweise auf der Startseite «Tag» (reine Logik). Jeder Hinweis führt direkt zur passenden Seite:
 * Einstellungen nur für Inhaber/Manager, Posteingang für alle, die ihn sehen.
 */
export type DayNotice = { key: string; text: string; href: string; tone: "warn" | "info" };

export type DayNoticeInput = {
  base: string;
  manages: boolean;
  channexEnabled: boolean;
  channexFailed: number;
  /** Zimmertypen ohne Foto; der Hinweis führt in den Fotos-Reiter des ersten */
  roomTypesWithoutPhoto: { id: string; name: string }[];
  openGuestRequests: number;
  openInquiries: number;
  /** Posteingang für Anfragen und Wünsche sichtbar? */
  inboxVisible: boolean;
};

export function dayNotices(i: DayNoticeInput): DayNotice[] {
  const out: DayNotice[] = [];
  if (i.manages && i.channexEnabled && i.channexFailed > 0) {
    out.push({ key: "channex", tone: "warn", text: `Der Abgleich mit Booking.com & Co. hat ${i.channexFailed} Fehler. Prüfen Sie die Kanäle.`, href: `${i.base}/channex` });
  }
  if (i.manages && i.roomTypesWithoutPhoto.length) {
    const names = i.roomTypesWithoutPhoto.slice(0, 3).map((n) => `«${n.name}»`).join(", ") + (i.roomTypesWithoutPhoto.length > 3 ? " …" : "");
    out.push({ key: "photos", tone: "info", text: `Foto fehlt bei ${names}. Gäste buchen eher mit Bildern.`, href: `${i.base}/rooms?rt=${i.roomTypesWithoutPhoto[0].id}&tab=fotos` });
  }
  if (i.inboxVisible && i.openGuestRequests > 0) {
    out.push({ key: "wishes", tone: "info", text: `${i.openGuestRequests} offene${i.openGuestRequests === 1 ? "r" : ""} Gästewunsch${i.openGuestRequests === 1 ? "" : "e"}.`, href: `${i.base}/inbox?quelle=wuensche` });
  }
  if (i.inboxVisible && i.openInquiries > 0) {
    out.push({ key: "inquiries", tone: "info", text: `${i.openInquiries} offene Anfrage${i.openInquiries === 1 ? "" : "n"} von Website oder Chat.`, href: `${i.base}/inbox?quelle=web` });
  }
  return out;
}
