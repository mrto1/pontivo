export const dynamic = "force-static";

export function GET() {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keine Verbindung</title>
<style>body{font-family:system-ui,sans-serif;background:#faf8f5;color:#1f2a2e;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
button{font:inherit;font-weight:600;background:#2f5d50;color:#fff;border:0;border-radius:8px;padding:12px 20px;margin-top:16px}</style></head>
<body><main><h1>Keine Verbindung</h1><p>Pontivo braucht Internet, damit Kalender und Buchungen immer aktuell sind.</p><button onclick="location.reload()">Erneut versuchen</button></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}
