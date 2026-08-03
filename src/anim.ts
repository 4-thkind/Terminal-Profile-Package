import { buildRows } from './render.js';
import { gradientColor } from './color.js';
import type { LoadedImage } from './image.js';

export const RESET = '\x1b[0m';
export const CLEAR_LINE = '\x1b[K';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const CYAN = '\x1b[36m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function log(msg = '') {
  process.stdout.write(msg + '\n');
}

const GLITCH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*+=?/\\|';
const randomChar = () => GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];

export async function renderImage(
  img: LoadedImage | null,
  opts: { truecolor: boolean; speed: number; fast: boolean; availW?: number; availH?: number; isDefaultBanner?: boolean; faceImg?: LoadedImage }
): Promise<void> {
  const rows = buildRows(img, opts.truecolor, 1, opts.availW ?? 100, opts.isDefaultBanner ?? true, opts.faceImg, opts.availH ?? 40);
  const ms = opts.fast ? 1 : opts.speed;
  for (const row of rows) {
    process.stdout.write(row + '\n');
    await sleep(ms);
  }
}

export async function glitchReveal(text: string, opts: { truecolor: boolean; fast: boolean }): Promise<void> {
  const ms = opts.fast ? 1 : 24;
  const len = text.length;

  for (let f = 0; f < 14; f++) {
    let line = '';
    for (let j = 0; j < len; j++) {
      if (text[j] === ' ') line += ' ';
      else line += Math.random() < 0.08 ? text[j] : randomChar();
    }
    process.stdout.write('\r' + CYAN + '› ' + RESET + line + RESET + CLEAR_LINE);
    await sleep(ms);
  }

  for (let i = 0; i <= len; i++) {
    let line = '';
    for (let j = 0; j < len; j++) {
      if (j < i) line += text[j];
      else if (text[j] === ' ') line += ' ';
      else line += Math.random() < 0.18 ? randomChar() : ' ';
    }
    const t = i / len;
    process.stdout.write('\r' + CYAN + '› ' + RESET + gradientColor(t, opts.truecolor) + line + RESET + CLEAR_LINE);
    await sleep(ms);
  }

  process.stdout.write('\r' + CYAN + '› ' + RESET + GREEN + BOLD + text + RESET + CLEAR_LINE + '\n');
}

export function waitForKey(): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve();
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* noop */
      }
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('error', onError);
    };
    const onData = (key: Buffer | string) => {
      const s = key.toString();
      if (s === '\u0003') {
        cleanup();
        process.exit(0);
      }
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      resolve();
    };
    process.stdin.on('data', onData);
    process.stdin.on('error', onError);
  });
}
