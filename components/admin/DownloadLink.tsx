/**
 * Einheitlicher Knopf für jeden Export/Download (CSV, Excel, PDF): Symbol + Text, gleiche Form überall.
 * `primary` = gefüllt (Hauptexport einer Karte), sonst umrandet.
 */
export function DownloadLink({ href, children, primary, target }: { href: string; children: React.ReactNode; primary?: boolean; target?: "_blank" }) {
  return (
    <a className={`btn-dl${primary ? " primary" : ""}`} href={href} target={target}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
      {children}
    </a>
  );
}
