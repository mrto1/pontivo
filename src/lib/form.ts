/** Text aus einem Formularfeld (FormData), ohne Leerzeichen am Rand; fehlt das Feld, ist es "" */
export const s = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
