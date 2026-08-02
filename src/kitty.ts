import { sleep } from './anim.js';

const ST = '\x1b\\';

/**
 * Windows Terminal (and other VT340-style terminals) render Sixel images against a
 * fixed virtual character cell of 10 x 20 device px. One image pixel maps to a square
 * device pixel, so an image that is W x H device px occupies ceil(W/10) columns and
 * ceil(H/20) rows.
 */
export const SIXEL_CELL_W = 10;
export const SIXEL_CELL_H = 20;

export function detectSixel(timeoutMs = 400): Promise<boolean> {
  const env = process.env;
  if (env.WT_SESSION || env.WT_PROFILE_ID) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    if (!process.stdout.isTTY) {
      resolve(false);
      return;
    }
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    const onData = (d: Buffer | string) => {
      const s = d.toString();
      // DEC DA1: CSI ? Ps;Ps;Ps c — the token 4 in the list means sixel graphics support
      if (/\?(?:\d+;)*4(?:;\d+)*c/.test(s) || /;4;/m.test(s)) finish(true);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    process.stdin.setEncoding('utf8');
    try {
      process.stdin.setRawMode(true);
    } catch {
      /* ignore */
    }
    process.stdin.resume();
    process.stdin.on('data', onData);
    process.stdout.write(`\x1b[c`);
  });
}

export function encodeSixel(pixels: Buffer, width: number, height: number, channels: number): string {
  const level = 6;
  const bands = Math.max(1, Math.ceil(height / 6));

  const colorId = new Map<number, number>();
  const palette: number[][] = [];
  const getColor = (r8: number, g8: number, b8: number): number => {
    const ri = Math.min(level - 1, Math.floor((r8 * level) / 256));
    const gi = Math.min(level - 1, Math.floor((g8 * level) / 256));
    const bi = Math.min(level - 1, Math.floor((b8 * level) / 256));
    const key = (ri * level + gi) * level + bi;
    let id = colorId.get(key);
    if (id === undefined) {
      id = colorId.size;
      colorId.set(key, id);
      palette[id] = [
        Math.round((r8 * 100) / 255),
        Math.round((g8 * 100) / 255),
        Math.round((b8 * 100) / 255),
      ];
    }
    return id;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = (y * width + x) * channels;
      getColor(pixels[j], pixels[j + 1], pixels[j + 2]);
    }
  }

  let out = '\x1bP9;1q';
  palette.forEach((c, i) => {
    out += `#${i};2;${c[0]};${c[1]};${c[2]}`;
  });

  for (let b = 0; b < bands; b++) {
    const y0 = b * 6;
    const colByColor = new Map<number, number[]>();
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 6; k++) {
        const y = y0 + k;
        if (y >= height) continue;
        const j = (y * width + x) * channels;
        const id = getColor(pixels[j], pixels[j + 1], pixels[j + 2]);
        if (!colByColor.has(id)) colByColor.set(id, new Array<number>(width).fill(0));
        colByColor.get(id)![x] |= 1 << k;
      }
    }
    for (const [id, masks] of colByColor) {
      out += `#${id}` + compressSixelRuns(masks) + '$';
    }
    out += '-';
  }

  out += ST;
  return out;
}

function compressSixelRuns(masks: number[]): string {
  let s = '';
  let prev = -1;
  let run = 0;
  const flush = () => {
    if (run <= 0) return;
    if (run === 1) {
      s += String.fromCharCode(63 + prev);
    } else {
      while (run > 0) {
        const n = Math.min(255, run);
        s += `!${n}` + String.fromCharCode(63 + prev);
        run -= n;
      }
    }
    prev = -1;
  };
  for (const v of masks) {
    if (v === prev) {
      run++;
    } else {
      flush();
      prev = v;
      run = 1;
    }
  }
  flush();
  return s;
}

const SIXEL_BAND = 6;

/**
 * Pick device-pixel dims so the sixel image fits `cols` x `maxRows` terminal cells.
 * With the VT340 virtual cell (10 x 20 device px), an image of W x H device px
 * occupies ceil(W/10) columns and ceil(H/20) rows. The encoder always emits whole
 * 6px bands, so the height is rounded down to a multiple of 6 to guarantee the
 * rendered row count matches ceil(H/20).
 */
export function sixelDims(srcW: number, srcH: number, cols: number, maxRows: number): { w: number; h: number } {
  let w = cols * SIXEL_CELL_W;
  let h = Math.round((w * srcH) / srcW);
  const maxH = maxRows * SIXEL_CELL_H;
  if (h > maxH) {
    h = maxH;
    w = Math.round((h * srcW) / srcH);
  }
  h = Math.max(SIXEL_BAND, Math.floor(h / SIXEL_BAND) * SIXEL_BAND);
  return { w: Math.max(1, w), h };
}

/** Pick device-pixel dims sized by target terminal ROWS (used for the banner-card face). */
export function sixelFaceDims(srcW: number, srcH: number, rows: number, maxCols: number): { w: number; h: number } {
  let h = rows * SIXEL_CELL_H;
  let w = Math.round((h * srcW) / srcH);
  const maxW = maxCols * SIXEL_CELL_W;
  if (w > maxW) {
    w = maxW;
    h = Math.round((w * srcH) / srcW);
  }
  h = Math.max(SIXEL_BAND, Math.floor(h / SIXEL_BAND) * SIXEL_BAND);
  return { w: Math.max(1, w), h };
}

export function detectKitty(timeoutMs = 400): Promise<boolean> {
  const env = process.env;
  const fastPath =
    env.KITTY_WINDOW_ID ||
    env.KITTY_PID ||
    env.WEZTERM_EXECUTABLE ||
    env.WEZTERM_PANE ||
    env.WEZTERM_UNIX_SOCKET ||
    env.GHOSTTY_RESOURCES_DIR ||
    env.TERM === 'xterm-kitty' ||
    env.TERM === 'xterm-ghostty' ||
    env.TERM_PROGRAM === 'ghostty' ||
    env.TERM_PROGRAM === 'kitty' ||
    env.TERM_PROGRAM === 'WezTerm';
  if (fastPath) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    if (!process.stdout.isTTY) {
      resolve(false);
      return;
    }
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    const onData = (d: Buffer | string) => {
      if (d.toString().includes('OK')) finish(true);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    process.stdin.setEncoding('utf8');
    try {
      process.stdin.setRawMode(true);
    } catch {
      /* ignore */
    }
    process.stdin.resume();
    process.stdin.on('data', onData);
    process.stdout.write(`\x1b_Ga=q,i=1,s=1,v=1,t=d,f=24;AAAA${ST}`);
  });
}

export function transmitPNG(png: Buffer, id = 1): void {
  const b64 = png.toString('base64');
  const chunk = 4096;
  let out = '';
  let first = true;
  for (let i = 0; i < b64.length; i += chunk) {
    const part = b64.slice(i, i + chunk);
    const last = i + chunk >= b64.length;
    if (first) {
      out += `\x1b_Ga=t,q=2,f=100,i=${id},m=${last ? 0 : 1};${part}${ST}`;
      first = false;
    } else {
      out += `\x1b_Gm=${last ? 0 : 1};${part}${ST}`;
    }
  }
  process.stdout.write(out);
}

export interface PlaceOpts {
  id: number;
  col: number;
  row: number;
  sw: number;
  sh: number;
  cols: number;
  pid?: number;
}

export function placeImage(o: PlaceOpts): void {
  const pid = o.pid ?? 1;
  process.stdout.write(
    `\x1b[${o.row};${o.col}H` +
      `\x1b_Ga=p,q=2,i=${o.id},p=${pid},x=0,y=0,w=${o.sw},h=${o.sh},c=${o.cols},C=1${ST}`
  );
}

const CELL_ASPECT = 2.0;

export function fitCols(srcW: number, srcH: number, availW: number, availH: number): number {
  const colsByH = (availH * CELL_ASPECT * srcW) / srcH;
  return Math.max(20, Math.min(availW, Math.floor(colsByH)));
}

export interface KittyAnimateOpts {
  cols: number;
  row: number;
  fast: boolean;
  speed: number;
}

export async function animateKittyImage(
  png: Buffer,
  srcW: number,
  srcH: number,
  opts: KittyAnimateOpts
): Promise<number> {
  transmitPNG(png, 1);
  const pxPerCellX = srcW / Math.max(1, opts.cols);
  const pxPerCellY = pxPerCellX * CELL_ASPECT;
  const cellsH = Math.max(1, Math.round(srcH / pxPerCellY));
  const ms = opts.fast ? 1 : Math.max(6, opts.speed);
  for (let i = 1; i <= cellsH; i++) {
    const sh = Math.round((srcH * i) / cellsH);
    placeImage({ id: 1, col: 1, row: opts.row, sw: srcW, sh, cols: opts.cols, pid: 1 });
    await sleep(ms);
  }
  return cellsH;
}
