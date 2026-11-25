/** Breite und Höhe eines PNG-, JPEG- oder WebP-Bildes aus den ersten Bytes (ohne Bibliothek); null, wenn nicht lesbar */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const str = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  // PNG: IHDR
  if (b.length >= 24 && b[0] === 0x89 && str(1, 3) === "PNG") {
    const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    return { width: u32(16), height: u32(20) };
  }
  // JPEG: erster SOF-Block
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: u16(i + 5), width: u16(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  // WebP
  if (b.length >= 30 && str(0, 4) === "RIFF" && str(8, 4) === "WEBP") {
    const k = str(12, 4);
    if (k === "VP8X") return { width: le24(24) + 1, height: le24(27) + 1 };
    if (k === "VP8 ") return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (k === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
