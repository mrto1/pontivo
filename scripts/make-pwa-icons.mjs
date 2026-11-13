// Platzhalter-Icons für die Admin-PWA (weisses «P» auf Pontivo-Grün) → src/pwa/icons.generated.ts
// Aufruf: node scripts/make-pwa-icons.mjs   (benötigt sharp, kommt mit Next.js)
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#2f5d50"/>
<path fill="#fff" d="M186 132h82a76 76 0 0 1 0 152h-34v96h-48z M234 176v64h34a32 32 0 0 0 0-64z" fill-rule="evenodd"/></svg>`;
const out = {};
for (const size of [180, 192, 512]) out[size] = (await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()).toString("base64");
writeFileSync(
  new URL("../src/pwa/icons.generated.ts", import.meta.url),
  `// Erzeugt von scripts/make-pwa-icons.mjs (Platzhalter, bis ein Logo vorliegt)\nexport const PWA_ICONS: Record<string, string> = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
