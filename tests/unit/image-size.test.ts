import { describe, expect, it } from "vitest";
import { imageSize } from "../../src/lib/image-size";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
};

describe("imageSize", () => {
  it("PNG", () => expect(imageSize(png(512, 300))).toEqual({ width: 512, height: 300 }));
  it("JPEG (SOF0)", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x02, 0x00, 3, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(b)).toEqual({ width: 512, height: 300 });
  });
  it("WebP (VP8X)", () => {
    const b = new Uint8Array(30);
    b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    b.set([0xff, 0x01, 0], 24); b.set([0x2b, 0x01, 0], 27);
    expect(imageSize(b)).toEqual({ width: 512, height: 300 });
  });
  it("Unbekanntes", () => expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull());
});
