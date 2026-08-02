import { rgbForeground, rgbBackground } from './color.js';
import { ditherRGB } from './quantize.js';
import { transmitPNG, placeImage, encodeSixel, SIXEL_CELL_W, SIXEL_CELL_H } from './kitty.js';
import type { LoadedImage } from './image.js';

const HALF_BLOCK = '▀';
const FULL_BLOCK = '█';
const RESET = '\x1b[0m';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/*
 * Sextant block characters (U+1FB00–U+1FB3B, "Symbols for Legacy Computing").
 *
 * Each character paints a 2×3 grid of sub-cells inside one terminal cell:
 *
 *        col 0   col 1
 *   row 0  [1]    [2]      bit values:  0x01, 0x02
 *   row 1  [3]    [4]                    0x04, 0x08
 *   row 2  [5]    [6]                    0x10, 0x20
 */

const SEXTANT_BASE = 0x1fb00;
const SEXTANT_BITS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20];

function sextantList(n: number): number[][] {
  const list: number[][] = [];
  for (let k = 1; k <= n; k++) {
    const next: number[][] = [];
    for (const s of [[] as number[], ...list]) next.push([...s, k]);
    list.push(...next);
  }
  return list;
}

const SEXTANT_BY_MASK: Map<number, string> = (() => {
  const table = new Map<number, string>();
  const subsets = sextantList(6).filter((s) => {
    const key = s.join(',');
    return key !== '1,3,5' && key !== '2,4,6' && key !== '1,2,3,4,5,6';
  });
  subsets.forEach((s, i) => {
    const mask = s.reduce((acc, cell) => acc | SEXTANT_BITS[cell - 1], 0);
    table.set(mask, String.fromCodePoint(SEXTANT_BASE + i));
  });
  return table;
})();

function sextantChar(mask: number): string {
  if (mask === 0) return ' ';
  if (mask === 0x3f) return FULL_BLOCK;
  if (mask === 0x15) return '▌';
  if (mask === 0x2a) return '▐';
  const ch = SEXTANT_BY_MASK.get(mask);
  if (ch !== undefined) return ch;
  let m = mask;
  let fallback = SEXTANT_BY_MASK.get(m);
  while (fallback === undefined && m !== 0) {
    m &= m - 1;
    fallback = SEXTANT_BY_MASK.get(m);
  }
  return fallback ?? ' ';
}

function getVisualWidth(str: string): number {
  const stripped = str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x1b]*(\x1b\\|\x07)/g, '');
  let width = 0;
  for (const char of Array.from(stripped)) {
    const code = char.codePointAt(0) || 0;
    if (code > 0xffff || (code >= 0x2600 && code <= 0x27ff)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

const PORTFOLIO_URL = 'https://portfolio.utkarshsingh72007.workers.dev/';

/** OSC 8 hyperlink: renders `label` as a clickable link to `url` (supported by Windows Terminal, kitty, etc.). */
function hyperlink(url: string, label: string): string {
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

interface CardLayout {
  totalCols: number;
  innerW: number;
  indent: number;
  contentRows: number;
  startRow: number;
}

/** Rows printed above the card by the caller: blank, header, separator, source, render. */
const HEADER_ROWS = 5;

/** Max visible width of any text line in the card (used to size the side panel). */
const MAX_TEXT_W = 50;

/** GitHub logo emoji used next to the clickable link. */
const GITHUB_LOGO = '🐙';

/**
 * Compute the card geometry at its natural size (no ratio forcing) so it fits
 * inside the terminal: the card keeps its natural width and height, is centred
 * horizontally, and starts right below the header so nothing overflows.
 */
function computeCardLayout(
  availW: number,
  availH: number,
  naturalCols: number,
  naturalRows: number
): CardLayout {
  const totalCols = Math.min(availW, Math.max(40, naturalCols));
  const contentRows = Math.max(1, naturalRows);
  const innerW = totalCols - 2;
  const indent = Math.max(0, Math.floor((availW - totalCols) / 2));
  const startRow = HEADER_ROWS + 1;
  return { totalCols, innerW, indent, contentRows, startRow };
}

interface CardPalette {
  R: string;
  BOLD: string;
  CYAN: string;
  GREEN: string;
  ORANGE: string;
  YELLOW: string;
  BRIGHT_GREEN: string;
  BLUE: string;
  RED: string;
  SLATE: string;
  BORDER: string;
  TITLE_BAR: string;
}

function cardPalette(truecolor: boolean): CardPalette {
  return {
    R: '\x1b[0m',
    BOLD: '\x1b[1m',
    CYAN: '\x1b[36m',
    GREEN: '\x1b[32m',
    ORANGE: truecolor ? '\x1b[38;2;255;140;0m' : '\x1b[38;5;208m',
    YELLOW: truecolor ? '\x1b[38;2;255;200;0m' : '\x1b[38;5;220m',
    BRIGHT_GREEN: truecolor ? '\x1b[38;2;50;230;100m' : '\x1b[38;5;82m',
    BLUE: truecolor ? '\x1b[38;2;50;180;255m' : '\x1b[38;5;75m',
    RED: truecolor ? '\x1b[38;2;240;70;70m' : '\x1b[38;5;196m',
    SLATE: truecolor ? '\x1b[38;2;170;195;220m' : '\x1b[38;5;250m',
    BORDER: truecolor ? '\x1b[38;2;30;80;150m' : '\x1b[38;5;24m',
    TITLE_BAR: truecolor ? '\x1b[38;2;140;180;220m\x1b[48;2;15;25;45m' : '\x1b[38;5;250m\x1b[48;5;234m',
  };
}

/** Shared card content: name, info, highlights, contact, and clickable links. */
function cardTextLines(p: CardPalette, sep: string): string[] {
  return [
    p.CYAN + p.BOLD + 'Utkarsh Singh' + p.R,
    p.BORDER + sep + p.R,
    p.CYAN + p.BOLD + 'Institute: ' + p.R + p.SLATE + 'MAIT, New Delhi · B.Tech CSE (AI)' + p.R,
    p.CYAN + p.BOLD + 'CGPA: ' + p.R + p.GREEN + p.BOLD + '9.3' + p.R + p.SLATE + ' / 10' + p.R,
    p.CYAN + p.BOLD + 'Stack: ' + p.R + p.SLATE + 'Python · FastAPI · TypeScript · Node.js' + p.R,
    p.CYAN + p.BOLD + 'AI/ML: ' + p.R + p.SLATE + 'Agentic AI · RAG · GNNs · LLMs' + p.R,
    p.CYAN + p.BOLD + 'Cloud: ' + p.R + p.SLATE + 'AWS · GCP · Docker · GitHub Actions' + p.R,
    '',
    p.CYAN + p.BOLD + 'Highlights:' + p.R,
    p.ORANGE + '› ICML 2026 - Adaptive Termination in Agentic RAG' + p.R,
    p.YELLOW + '› ET GenAI Hackathon - Top Performer · 3000+' + p.R,
    p.BRIGHT_GREEN + '› Contributor at GSoC \'26 · SSoC \'26' + p.R,
    p.BLUE + '› Gemini Certified University Student' + p.R,
    '',
    p.CYAN + p.BOLD + 'Contact:' + p.R,
    p.RED + '✉  ' + p.R + p.SLATE + hyperlink('mailto:utkarshsingh72007@gmail.com', 'utkarshsingh72007@gmail.com') + p.R,
    p.RED + GITHUB_LOGO + '  ' + p.R + p.SLATE + hyperlink('https://github.com/4-thkind', 'github.com/4-thkind') + p.R,
    p.RED + 'in ' + p.R + p.SLATE + hyperlink('https://linkedin.com/in/utkarsh-singh-361969378', 'linkedin.com/in/utkarsh-singh-361969378') + p.R,
    '',
    p.CYAN + p.BOLD + 'Portfolio:' + p.R,
    p.RED + '🌐  ' + p.R + p.SLATE + hyperlink(PORTFOLIO_URL, 'portfolio.utkarshsingh72007.workers.dev') + p.R,
  ];
}

export function buildRows(
  img: LoadedImage,
  truecolor: boolean,
  margin = 1,
  availW = 100,
  isDefaultBanner = true,
  faceImg?: LoadedImage,
  availH = 40
): string[] {
  if (isDefaultBanner) {
    return buildBannerCardRows(img, truecolor, availW, availH, faceImg);
  }
  if (truecolor) return buildSextantRows(img, margin);
  return buildHalfBlockRows(img, margin);
}

/**
 * Render the card with Kitty inline image for the face.
 * Prints the card row-by-row, then overlays the face PNG on top
 * using Kitty graphics placement at the exact cell coordinates.
 */
export async function renderCardWithKittyFace(
  facePng: Buffer,
  faceW: number,
  faceH: number,
  truecolor: boolean,
  availW: number,
  availH: number,
  fast = false,
  speed = 22
): Promise<void> {
  const ms = fast ? 1 : speed;
  const p = cardPalette(truecolor);

  // Size the face so it keeps roughly the same height as before, just narrower
  const CELL_ASPECT = 2.0;
  const targetFaceRows = 24;
  const faceCols = Math.max(1, Math.round((targetFaceRows * CELL_ASPECT) / (faceH / faceW)));
  const kittyFaceRows = Math.ceil(faceCols * (faceH / faceW) / CELL_ASPECT);

  const textLines = cardTextLines(p, '');

  const naturalCols = faceCols + 3 + MAX_TEXT_W + 5;
  const naturalRows = Math.max(kittyFaceRows, textLines.length);
  const layout = computeCardLayout(availW, availH, naturalCols, naturalRows);
  const { innerW, indent, contentRows, startRow } = layout;

  textLines[1] = p.BORDER + '─'.repeat(Math.max(10, innerW - 1 - Math.min(faceCols, innerW - 3) - 2)) + p.R;

  const contentTopPad = Math.max(0, Math.floor((contentRows - naturalRows) / 2));
  const cardRows: string[] = [];

  cardRows.push(p.BORDER + '╭' + '─'.repeat(innerW) + '╮' + p.R);

  const titleText = '@4-thkind/info';
  const leftPad = Math.floor((innerW - titleText.length - 16) / 2);
  const rightPadN = innerW - titleText.length - 16 - leftPad;
  cardRows.push(
    p.BORDER +
    '│' +
    p.TITLE_BAR +
    '  🔍  ' +
    ' '.repeat(Math.max(0, leftPad)) +
    p.BOLD +
    titleText +
    p.R +
    p.TITLE_BAR +
    ' '.repeat(Math.max(0, rightPadN)) +
    '  + = X  ' +
    p.R +
    p.BORDER +
    '│' +
    p.R
  );
  cardRows.push(p.BORDER + '├' + '─'.repeat(innerW) + '┤' + p.R);

  const faceColsCapped = Math.min(faceCols, innerW - 3);
  for (let i = 0; i < contentRows; i++) {
    const contentI = i - contentTopPad;
    const fl = ' '.repeat(faceColsCapped);
    const tl = contentI >= 0 ? textLines[contentI] || '' : '';
    const visLen = getVisualWidth(tl);
    const padNeeded = Math.max(0, innerW - 1 - faceColsCapped - 2 - visLen);
    cardRows.push(p.BORDER + '│ ' + p.R + fl + '  ' + tl + ' '.repeat(padNeeded) + p.BORDER + '│' + p.R);
  }

  const promptText = '[from ashes i claim ~]$ ';
  const promptVisLen = getVisualWidth(promptText) + 1;
  const promptPad = Math.max(0, innerW - 1 - promptVisLen);
  cardRows.push(p.BORDER + '├' + '─'.repeat(innerW) + '┤' + p.R);
  cardRows.push(p.BORDER + '│ ' + p.R + p.CYAN + p.BOLD + promptText + p.R + '█' + ' '.repeat(promptPad) + p.BORDER + '│' + p.R);
  cardRows.push(p.BORDER + '╰' + '─'.repeat(innerW) + '╯' + p.R);

  // Move to the vertically-centred start row, then print the card frame/text
  process.stdout.write(`\x1b[${startRow};1H`);
  for (const row of cardRows) {
    process.stdout.write(' '.repeat(indent) + row + '\n');
    await sleep(ms);
  }

  // Account for viewport scrolling that may have occurred during card printing
  const totalCardRows = cardRows.length;
  const scrollAmount = Math.max(0, startRow + totalCardRows - availH);

  // Overlay the face PNG using Kitty graphics protocol
  const imgId = 42;
  transmitPNG(facePng, imgId);
  const faceRow = startRow + 3 + contentTopPad - scrollAmount;
  if (faceRow >= 1) {
    placeImage({
      id: imgId,
      col: 3 + indent,
      row: faceRow,
      sw: faceW,
      sh: faceH,
      cols: faceColsCapped,
    });
  }
  process.stdout.write(`\x1b[${startRow + totalCardRows - scrollAmount};1H`);
}

export async function renderCardWithSixelFace(
  faceImg: LoadedImage,
  truecolor: boolean,
  availW: number,
  availH: number,
  fast = false,
  speed = 22
): Promise<void> {
  const ms = fast ? 1 : speed;
  const p = cardPalette(truecolor);

  const faceCols = Math.max(1, Math.ceil(faceImg.width / SIXEL_CELL_W));
  const faceRows = Math.max(1, Math.ceil(faceImg.height / SIXEL_CELL_H));

  const textLines = cardTextLines(p, '');

  const naturalCols = faceCols + 3 + MAX_TEXT_W + 5;
  const naturalRows = Math.max(faceRows, textLines.length);
  const layout = computeCardLayout(availW, availH, naturalCols, naturalRows);
  const { innerW, indent, contentRows, startRow } = layout;

  textLines[1] = p.BORDER + '─'.repeat(Math.max(10, innerW - 1 - Math.min(faceCols, innerW - 3) - 2)) + p.R;

  const contentTopPad = Math.max(0, Math.floor((contentRows - naturalRows) / 2));
  const cardRows: string[] = [];

  cardRows.push(p.BORDER + '╭' + '─'.repeat(innerW) + '╮' + p.R);

  const titleText = '@4-thkind/info';
  const leftPad = Math.floor((innerW - titleText.length - 16) / 2);
  const rightPadN = innerW - titleText.length - 16 - leftPad;
  cardRows.push(
    p.BORDER +
    '│' +
    p.TITLE_BAR +
    '  🔍  ' +
    ' '.repeat(Math.max(0, leftPad)) +
    p.BOLD +
    titleText +
    p.R +
    p.TITLE_BAR +
    ' '.repeat(Math.max(0, rightPadN)) +
    '  + = X  ' +
    p.R +
    p.BORDER +
    '│' +
    p.R
  );
  cardRows.push(p.BORDER + '├' + '─'.repeat(innerW) + '┤' + p.R);

  const faceColsCapped = Math.min(faceCols, innerW - 3);
  for (let i = 0; i < contentRows; i++) {
    const contentI = i - contentTopPad;
    const fl = ' '.repeat(faceColsCapped); // blank — Sixel image overlays here
    const tl = contentI >= 0 ? textLines[contentI] || '' : '';
    const visLen = getVisualWidth(tl);
    const padNeeded = Math.max(0, innerW - 1 - faceColsCapped - 2 - visLen);
    cardRows.push(p.BORDER + '│ ' + p.R + fl + '  ' + tl + ' '.repeat(padNeeded) + p.BORDER + '│' + p.R);
  }

  const promptText = '[from ashes i claim ~]$ ';
  const promptVisLen = getVisualWidth(promptText) + 1;
  const promptPad = Math.max(0, innerW - 1 - promptVisLen);
  cardRows.push(p.BORDER + '├' + '─'.repeat(innerW) + '┤' + p.R);
  cardRows.push(p.BORDER + '│ ' + p.R + p.CYAN + p.BOLD + promptText + p.R + '█' + ' '.repeat(promptPad) + p.BORDER + '│' + p.R);
  cardRows.push(p.BORDER + '╰' + '─'.repeat(innerW) + '╯' + p.R);

  // Move to the vertically-centred start row, then print the card frame/text
  process.stdout.write(`\x1b[${startRow};1H`);
  for (const row of cardRows) {
    process.stdout.write(' '.repeat(indent) + row + '\n');
    await sleep(ms);
  }

  // Account for viewport scrolling that may have occurred during card printing
  const totalCardRows = cardRows.length;
  const scrollAmount = Math.max(0, startRow + totalCardRows - availH);

  // Overlay the face using the Sixel protocol at the face area
  const faceRow = startRow + 3 + contentTopPad - scrollAmount;
  if (faceRow >= 1) {
    process.stdout.write(`\x1b[${faceRow};${3 + indent}H`);
    process.stdout.write(encodeSixel(faceImg.pixels, faceImg.width, faceImg.height, faceImg.channels));
  }

  // Move cursor to after the card
  process.stdout.write(`\x1b[${startRow + totalCardRows - scrollAmount};1H`);
}

export function buildBannerCardRows(
  img: LoadedImage,
  truecolor: boolean,
  availW = 100,
  availH = 40,
  faceImg?: LoadedImage
): string[] {
  const p = cardPalette(truecolor);
  const faceCols = 44;

  const targetImg = faceImg || img;
  const faceLines = truecolor ? buildSextantRows(targetImg, 0) : buildHalfBlockRows(targetImg, 0);

  const rightW = 76 - 1 - faceCols - 2;
  const sep = '─'.repeat(Math.max(10, rightW - 2));
  const textLines = cardTextLines(p, sep);

  const naturalCols = faceCols + 3 + MAX_TEXT_W + 5;
  const naturalRows = Math.max(faceLines.length, textLines.length);
  const layout = computeCardLayout(availW, availH, naturalCols, naturalRows);
  const { innerW, indent, contentRows } = layout;

  textLines[1] = p.BORDER + '─'.repeat(Math.max(10, innerW - 1 - Math.min(faceCols, innerW - 3) - 2)) + p.R;

  const contentTopPad = Math.max(0, Math.floor((contentRows - naturalRows) / 2));
  const cardRows: string[] = [];

  cardRows.push(' '.repeat(indent) + p.BORDER + '╭' + '─'.repeat(innerW) + '╮' + p.R);

  const titleText = '@4-thkind/info';
  const leftPad = Math.floor((innerW - titleText.length - 16) / 2);
  const rightPadN = innerW - titleText.length - 16 - leftPad;
  cardRows.push(
    ' '.repeat(indent) +
    p.BORDER +
    '│' +
    p.TITLE_BAR +
    '  🔍  ' +
    ' '.repeat(Math.max(0, leftPad)) +
    p.BOLD +
    titleText +
    p.R +
    p.TITLE_BAR +
    ' '.repeat(Math.max(0, rightPadN)) +
    '  + = X  ' +
    p.R +
    p.BORDER +
    '│' +
    p.R
  );
  cardRows.push(' '.repeat(indent) + p.BORDER + '├' + '─'.repeat(innerW) + '┤' + p.R);

  const faceColsCapped = Math.min(faceCols, innerW - 3);
  for (let i = 0; i < contentRows; i++) {
    const contentI = i - contentTopPad;
    const fl = (contentI >= 0 && faceLines[contentI] ? faceLines[contentI] : ' '.repeat(faceColsCapped));
    const tl = contentI >= 0 ? textLines[contentI] || '' : '';
    const visLen = getVisualWidth(tl);
    const padNeeded = Math.max(0, innerW - 1 - faceColsCapped - 2 - visLen);
    cardRows.push(' '.repeat(indent) + p.BORDER + '│ ' + p.R + fl + '  ' + tl + ' '.repeat(padNeeded) + p.BORDER + '│' + p.R);
  }

  const promptText = '[from ashes i claim ~]$ ';
  const promptVisLen = getVisualWidth(promptText) + 1;
  const promptPad = Math.max(0, innerW - 1 - promptVisLen);
  cardRows.push(' '.repeat(indent) + p.BORDER + '├' + '─'.repeat(innerW) + '┤' + p.R);
  cardRows.push(' '.repeat(indent) + p.BORDER + '│ ' + p.R + p.CYAN + p.BOLD + promptText + p.R + '█' + ' '.repeat(promptPad) + p.BORDER + '│' + p.R);
  cardRows.push(' '.repeat(indent) + p.BORDER + '╰' + '─'.repeat(innerW) + '╯' + p.R);

  return cardRows;
}

function buildSextantRows(img: LoadedImage, margin: number): string[] {
  const { width, height, channels } = img;
  const pixels = img.pixels;

  const colCount = Math.ceil(width / 2);
  const rowCount = Math.ceil(height / 3);
  const pad = ' '.repeat(margin);
  const rows: string[] = [];

  const dx = [0, 1, 0, 1, 0, 1];
  const dy = [0, 0, 1, 1, 2, 2];

  for (let r = 0; r < rowCount; r++) {
    const baseY = r * 3;
    let line = pad;

    for (let c = 0; c < colCount; c++) {
      const baseX = c * 2;

      const lums: number[] = [];
      const valid: boolean[] = [];
      let lumSum = 0;
      let validN = 0;

      for (let i = 0; i < 6; i++) {
        const x = baseX + dx[i];
        const y = baseY + dy[i];
        if (x >= width || y >= height) {
          lums.push(0);
          valid.push(false);
          continue;
        }
        const j = (y * width + x) * channels;
        const lum = 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2];
        lums.push(lum);
        valid.push(true);
        lumSum += lum;
        validN++;
      }

      const meanLum = validN > 0 ? lumSum / validN : 0;

      let mask = 0;
      let fr = 0, fg = 0, fb = 0, fn = 0;
      let br = 0, bg = 0, bb = 0, bn = 0;

      for (let i = 0; i < 6; i++) {
        if (!valid[i]) continue;
        const x = baseX + dx[i];
        const y = baseY + dy[i];
        const j = (y * width + x) * channels;
        const r8 = pixels[j];
        const g8 = pixels[j + 1];
        const b8 = pixels[j + 2];

        if (lums[i] < meanLum) {
          mask |= SEXTANT_BITS[i];
          fr += r8; fg += g8; fb += b8; fn++;
        } else {
          br += r8; bg += g8; bb += b8; bn++;
        }
      }

      const frc = fn > 0 ? Math.round(fr / fn) : 0;
      const fgc = fn > 0 ? Math.round(fg / fn) : 0;
      const fbc = fn > 0 ? Math.round(fb / fn) : 0;
      const brc = bn > 0 ? Math.round(br / bn) : frc;
      const bgc = bn > 0 ? Math.round(bg / bn) : fgc;
      const bbc = bn > 0 ? Math.round(bb / bn) : fbc;

      line +=
        rgbForeground(frc, fgc, fbc, true) +
        rgbBackground(brc, bgc, bbc, true) +
        sextantChar(mask);
    }

    line += RESET;
    rows.push(line);
  }

  return rows;
}

function buildHalfBlockRows(img: LoadedImage, margin: number): string[] {
  const { width, height, channels } = img;
  const effW = Math.floor(width / 2);
  const effH = Math.floor(height / 2);

  const downsampled = Buffer.alloc(effW * effH * channels);
  for (let y = 0; y < effH; y++) {
    for (let x = 0; x < effW; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = x * 2 + dx;
            const sy = y * 2 + dy;
            if (sx < width && sy < height) {
              sum += img.pixels[(sy * width + sx) * channels + c];
              count++;
            }
          }
        }
        downsampled[(y * effW + x) * channels + c] = count > 0 ? Math.round(sum / count) : 0;
      }
    }
  }

  const pixels = ditherRGB(downsampled, effW, effH, channels);

  const rowCount = Math.ceil(effH / 2);
  const pad = ' '.repeat(margin);
  const rows: string[] = [];

  for (let y = 0; y < rowCount; y++) {
    const topY = y * 2;
    const botY = topY + 1;
    let line = pad;

    for (let x = 0; x < effW; x++) {
      const top = (topY * effW + x) * channels;
      const tr = pixels[top] || 0;
      const tg = pixels[top + 1] || 0;
      const tb = pixels[top + 2] || 0;

      if (botY < effH) {
        const bot = (botY * effW + x) * channels;
        const br = pixels[bot] || 0;
        const bg = pixels[bot + 1] || 0;
        const bb = pixels[bot + 2] || 0;
        line += rgbForeground(tr, tg, tb, false) + rgbBackground(br, bg, bb, false) + HALF_BLOCK;
      } else {
        line += rgbForeground(tr, tg, tb, false) + HALF_BLOCK;
      }
    }

    line += RESET;
    rows.push(line);
  }

  return rows;
}

/**
 * Render a full-resolution image using the Sixel protocol (Windows Terminal 1.22+, xterm, foot).
 * The image is drawn inline at the current cursor position, scaled to `cols` terminal columns.
 * Returns the number of terminal rows the image occupies.
 */
export function renderSixelImage(
  img: LoadedImage,
  opts: { cols: number; row: number }
): number {
  const rowsOccupied = Math.max(1, Math.ceil(img.height / SIXEL_CELL_H));
  process.stdout.write(`\x1b[${opts.row};1H`);
  process.stdout.write(encodeSixel(img.pixels, img.width, img.height, img.channels));
  process.stdout.write(`\x1b[${opts.row + rowsOccupied};1H`);
  return rowsOccupied;
}

