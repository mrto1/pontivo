/**
 * Fehler mit einer Meldung für den Benutzer (deutsch, verständlich, ohne Technik).
 * Fachliche Fehlerklassen der Dienste erben davon. `hotelAction` (src/lib/hotel-action.ts)
 * zeigt ihre Meldung an; jeder andere Fehler gilt als Programmfehler und wird nicht angezeigt.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
