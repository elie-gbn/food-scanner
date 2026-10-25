/* Makes a soft camera frame easier to read. Laptop webcams often cannot focus up close, so bars smear into each other.
   Barcodes are read along a line, so the frame is stretched to full contrast, then sharpened sideways. */

const RADIUS = 3;
const AMOUNT = 3;

/** Turns an RGBA frame into a full-contrast, sideways-sharpened grey frame, in place. */
export function enhanceFrame(rgba: Uint8ClampedArray, width: number, height: number): void {
  const pixels = width * height;
  const grey = new Float32Array(pixels);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    const value = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    grey[p] = value;
    histogram[Math.min(255, Math.round(value))]++;
  }

  // Stretch the 2nd to 98th percentile of brightness across 0..255, so a dim or washed-out frame gets full contrast.
  const cut = pixels * 0.02;
  let low = 0;
  let high = 255;
  for (let sum = 0; low < 255 && (sum += histogram[low]) < cut; low++);
  for (let sum = 0; high > 0 && (sum += histogram[high]) < cut; high--);
  const range = Math.max(1, high - low);
  for (let p = 0; p < pixels; p++) grey[p] = Math.max(0, Math.min(255, ((grey[p] - low) / range) * 255));

  // Unsharp mask along each row: push every pixel away from the local average, then clip.
  const window = 2 * RADIUS + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -RADIUS; x <= RADIUS; x++) sum += grey[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      const value = grey[row + x];
      const sharp = Math.max(0, Math.min(255, value + AMOUNT * (value - sum / window)));
      const i = (row + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = sharp;
      rgba[i + 3] = 255;
      // The window's pixels come from the stretched copy, so the output never feeds back into the average.
      sum += grey[row + Math.min(width - 1, x + RADIUS + 1)] - grey[row + Math.max(0, x - RADIUS)];
    }
  }
}
