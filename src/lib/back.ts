/** Rücksprung nach einem Formular: nur Pfade auf derselben Website (kein //andere-seite.ch) */
export function safeBack(v: string): string {
  return /^\/(?!\/)[A-Za-z0-9/_\-.%]*$/.test(v) && v.length < 300 ? v : "/";
}
