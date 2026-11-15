/** Gästeportal (SPEC 19.13): Kalendereintrag zur Buchung. Reine Logik. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (d: string) => d.replace(/-/g, "");

/** Zeilen auf höchstens 75 Oktette falten (RFC 5545), ohne ein UTF-8-Zeichen zu zerschneiden */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export type IcsInput = { reference: string; hotelName: string; address: string; checkin: string; checkout: string; checkinTime: string; description: string; now?: Date };

/** Ganztägiger Eintrag von Anreise bis Abreise (DTEND ist der Abreisetag, exklusiv) */
export function bookingIcs(i: IcsInput): string {
  const stamp = (i.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pontivo//Gaesteportal//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${i.reference}@pontivo`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(i.checkin)}`, `DTEND;VALUE=DATE:${compact(i.checkout)}`,
    `SUMMARY:${esc(i.hotelName)}`, ...(i.address ? [`LOCATION:${esc(i.address)}`] : []), `DESCRIPTION:${esc(i.description)}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
