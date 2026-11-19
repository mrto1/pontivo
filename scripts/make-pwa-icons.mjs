// Platzhalter-Icons für die Admin-PWA (Logo «P als Brücke» auf Petrol) → src/pwa/icons.generated.ts
// Aufruf: node scripts/make-pwa-icons.mjs   (benötigt sharp, kommt mit Next.js)
import sharp from "sharp";
import { writeFileSync } from "node:fs";

// Logo B: P als Brücke (Bogen mit Bernstein-Punkt), weiss auf Petrol
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#0b7285"/>
<path d="M32 76V46A21 21 0 0 1 74 46V56" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><circle cx="74" cy="69" r="7.5" fill="#ffc247"/></svg>`;
const out = {};
for (const size of [180, 192, 512]) out[size] = (await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()).toString("base64");
writeFileSync(
  new URL("../src/pwa/icons.generated.ts", import.meta.url),
  `// Erzeugt von scripts/make-pwa-icons.mjs (Logo B)\nexport const PWA_ICONS: Record<string, string> = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
