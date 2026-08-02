export function ditherRGB(data: Buffer, width: number, height: number, channels: number): Buffer {
  const out = Buffer.from(data);
  const levels = 6;
  const step = 255 / (levels - 1);
  const at = (x: number, y: number, c: number) => (y * width + x) * channels + c;
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const i = at(x, y, c);
        const old = out[i];
        const nv = Math.round(old / step) * step;
        const err = old - nv;
        out[i] = nv;
        if (err === 0) continue;

        if (x + 1 < width) out[at(x + 1, y, c)] = clamp(out[at(x + 1, y, c)] + (err * 7) / 16);
        if (x - 1 >= 0 && y + 1 < height) out[at(x - 1, y + 1, c)] = clamp(out[at(x - 1, y + 1, c)] + (err * 3) / 16);
        if (y + 1 < height) out[at(x, y + 1, c)] = clamp(out[at(x, y + 1, c)] + (err * 5) / 16);
        if (x + 1 < width && y + 1 < height) out[at(x + 1, y + 1, c)] = clamp(out[at(x + 1, y + 1, c)] + (err * 1) / 16);
      }
    }
  }
  return out;
}
