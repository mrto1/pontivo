/**
 * Ton einer Rückmeldung nach einer Aktion (`?msg=…`): Fehler und Hinweise, dass etwas nicht geklappt hat, sind keine Erfolgsmeldung.
 * Die Server-Aktionen liefern nur Text; hier wird er einheitlich eingestuft, damit ein Fehler nie grün erscheint.
 */
export type MsgTone = "ok" | "error";

const ERROR = /(^(nicht|kein|keine|keinen|konto|abruf|logo:|zuerst|bitte|fehler|ungültig)\b)|\b(nicht möglich|nicht gefunden|nicht geklappt|nicht gespeichert|nicht erlaubt|nicht gelöscht|nicht gesendet|nicht verbunden|konnte|konnten|kann nicht|können nicht|fehlgeschlagen|fehlt|fehlen|ungültig|unbekannt|zu kurz|zu lang|zu viele|zu gross|falsch|abgelehnt|gesperrt|bereits vergeben|existiert bereits|mindestens|höchstens|muss|müssen|zuerst)\b/i;

export const msgTone = (text: string): MsgTone => (ERROR.test(text.trim()) ? "error" : "ok");
