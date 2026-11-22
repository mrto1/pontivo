/** Logo «P als Brücke» für die Kopfzeile des Admin; der Text «Pontivo» bleibt für Screenreader und Suche erhalten */
export function BrandMark() {
  return (
    <>
      <svg className="brand-mark" viewBox="0 0 96 96" aria-hidden="true">
        <path d="M30 82V44A23 23 0 0 1 76 44V56" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="76" cy="71" r="8" fill="#e0902b" />
      </svg>
      <span className="sr-only">Pontivo</span>
    </>
  );
}
