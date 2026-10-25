import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { enhanceFrame } from "./frame";

/* Draws a real EAN-13 barcode, blurs it like an unfocused webcam, and checks whether the decoder the app uses can read it. */

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
const CODE = "3021690201123";
const BLUR = 8;

function bitsFor(code: string) {
  const d = [...code].map(Number);
  let bits = "101";
  for (let i = 0; i < 6; i++) bits += (PARITY[d[0]][i] === "L" ? L : G)[d[i + 1]];
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
  return bits + "101";
}

function frame(module: number, blur: number) {
  const W = 640, H = 360, bars = 80;
  const bits = "0".repeat(9) + bitsFor(CODE) + "0".repeat(9);
  const data = new Uint8ClampedArray(W * H * 4);
  const x0 = Math.floor((W - bits.length * module) / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bit = bits[Math.floor((x - x0) / module)] === "1" && y > (H - bars) / 2 && y < (H + bars) / 2;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = bit ? 30 : 215;
      data[i + 3] = 255;
    }
  }
  // Horizontal smear, as an unfocused lens would give.
  for (let pass = 0; pass < blur; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = (data[i - 4] + data[i] * 2 + data[i + 4]) / 4;
      }
    }
  }
  return { data, width: W, height: H };
}

let detect: (image: { data: Uint8ClampedArray; width: number; height: number }) => Promise<string | null>;

beforeAll(async () => {
  // The decoder expects browser classes; these are enough for it to run in Node.
  const g = globalThis as Record<string, unknown>;
  g.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
  g.DOMRectReadOnly = class { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {} };
  const { BarcodeDetector, setZXingModuleOverrides } = await import("barcode-detector/ponyfill");
  setZXingModuleOverrides({ wasmBinary: new Uint8Array(fs.readFileSync("public/zxing_reader.wasm")).buffer });
  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  detect = async (image) => {
    const found = await detector.detect(new (g.ImageData as new (d: Uint8ClampedArray, w: number, h: number) => ImageData)(new Uint8ClampedArray(image.data), image.width, image.height));
    return found[0]?.rawValue ?? null;
  };
});

describe("enhanceFrame", () => {
  it("keeps a sharp barcode readable", async () => {
    const f = frame(3, 0);
    enhanceFrame(f.data, f.width, f.height);
    expect(await detect(f)).toBe(CODE);
  });

  it("reads a soft barcode that the plain frame cannot", async () => {
    const plain = frame(3, BLUR);
    expect(await detect(plain)).toBeNull();
    const soft = frame(3, BLUR);
    enhanceFrame(soft.data, soft.width, soft.height);
    expect(await detect(soft)).toBe(CODE);
  });

  it("outputs grey pixels with full alpha", () => {
    const f = frame(2, 2);
    enhanceFrame(f.data, f.width, f.height);
    let bad = 0;
    for (let i = 0; i < f.data.length; i += 4) if (f.data[i] !== f.data[i + 1] || f.data[i + 2] !== f.data[i] || f.data[i + 3] !== 255) bad++;
    expect(bad).toBe(0);
  });

  it("does not crash on a flat frame or a tiny one", () => {
    const flat = new Uint8ClampedArray(10 * 10 * 4).fill(128);
    expect(() => enhanceFrame(flat, 10, 10)).not.toThrow();
    const tiny = new Uint8ClampedArray(2 * 1 * 4).fill(50);
    expect(() => enhanceFrame(tiny, 2, 1)).not.toThrow();
  });
});
