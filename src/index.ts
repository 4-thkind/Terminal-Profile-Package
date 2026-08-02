#!/usr/bin/env node
import { loadAvatarImage, loadAvatarPNG, loadImage, loadPNG, getImageDims, loadImageAt } from './image.js';
import { renderCardWithKittyFace, renderCardWithSixelFace, renderSixelImage } from './render.js';
import { hasTrueColor } from './color.js';
import { renderImage, glitchReveal, waitForKey, sleep, RESET, CLEAR_LINE, BOLD, DIM, CYAN, YELLOW } from './anim.js';
import { detectKitty, detectSixel, animateKittyImage, fitCols, sixelDims, SIXEL_CELL_W, SIXEL_CELL_H } from './kitty.js';

interface CliArgs {
  image?: string;
  width?: number;
  speed: number;
  colors?: 'truecolor' | '256';
  kitty: 'auto' | 'on' | 'off';
  fast: boolean;
  help: boolean;
}

/** Portrait crop ratio (w/h) applied to the face so it fits the card panel without dominating the text. */
const FACE_ASPECT = 0.75;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { width: undefined, speed: 22, colors: undefined, kitty: 'auto', fast: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--image':
      case '-i':
        args.image = argv[++i];
        break;
      case '--width':
      case '-w':
        args.width = Number.parseInt(argv[++i], 10) || undefined;
        break;
      case '--speed':
        args.speed = Number.parseInt(argv[++i], 10) || 22;
        break;
      case '--colors':
        args.colors = argv[++i] === '256' ? '256' : 'truecolor';
        break;
      case '--kitty':
        args.kitty = 'on';
        break;
      case '--no-kitty':
        args.kitty = 'off';
        break;
      case '--fast':
        args.fast = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
    }
  }
  return args;
}

function printHelp() {
  const msg = [
    `${BOLD}utkarsh-info${RESET} — banner + portfolio, terminal style.`,
    ``,
    `  usage:  npx utkarsh-info [options]`,
    ``,
    `  ${CYAN}--image, -i <path>${RESET}  custom image file (jpg/png/webp)`,
    `  ${CYAN}--width, -w <n>${RESET}     max width in columns (default: fit terminal)`,
    `  ${CYAN}--speed <ms>${RESET}       scanline speed in ms/line (default 22)`,
    `  ${CYAN}--colors <mode>${RESET}    force block-art colors: truecolor | 256`,
    `  ${CYAN}--kitty${RESET}            force full-res image (kitty graphics protocol)`,
    `  ${CYAN}--no-kitty${RESET}         use block-art rendering instead`,
    `  ${CYAN}--fast${RESET}             skip animation delays`,
    `  ${CYAN}--help, -h${RESET}         show this help`,
    ``,
    `  full-res image uses kitty graphics (kitty, WezTerm, Ghostty) or Sixel`,
    `  (Windows Terminal 1.22+). Otherwise a pixel-art fallback is used.`,
    ``,
  ];
  msg.forEach((l) => process.stdout.write(l + '\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const tty = !!process.stdout.isTTY;
  const truecolor = args.colors ? args.colors === 'truecolor' : hasTrueColor();
  const fast = args.fast || !!process.env.UTKARSH_FAST;

  const kittyEnabled =
    args.kitty === 'on' ||
    (args.kitty === 'auto' && args.colors !== '256' && (await detectKitty()));
  const sixelEnabled = args.kitty !== 'on' && args.colors !== '256' && (await detectSixel());

  if (tty) {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  const cols = process.stdout.columns ?? 100;
  const rows = process.stdout.rows ?? 40;
  const availW = args.width !== undefined ? Math.max(24, Math.min(args.width, cols - 4)) : Math.max(24, cols - 4);

  log();
  log(CYAN + BOLD + '  utkarsh-info' + RESET + DIM + '  ·  rendering banner' + RESET);
  log(DIM + '  ' + '─'.repeat(Math.min(50, availW)) + RESET);
  await sleep(fast ? 1 : 120);

  const isDefaultBanner = !args.image;

  if (kittyEnabled && !isDefaultBanner) {
    const maxSource = Math.min(2200, Math.max(1200, cols * 2));
    const img = await loadPNG(args.image!, maxSource);
    const finalCols = fitCols(img.width, img.height, availW, rows - 8);
    log(DIM + `  › source: ${img.source}` + RESET);
    log(DIM + `  › render: kitty graphics · full-resolution image` + RESET);
    await sleep(fast ? 1 : 150);
    const cellsH = await animateKittyImage(img.png, img.width, img.height, {
      cols: finalCols,
      row: 6,
      fast,
      speed: args.speed,
    });
    process.stdout.write(`\x1b[${6 + cellsH};1H`);
  } else if (kittyEnabled && isDefaultBanner) {
    const faceImg = await loadAvatarPNG(900, FACE_ASPECT);
    log(DIM + `  › source: ${faceImg.source}` + RESET);
    log(DIM + `  › render: sharp terminal banner card (kitty inline photo) · ${availW} cols` + RESET);
    await sleep(fast ? 1 : 150);
    await renderCardWithKittyFace(faceImg.png, faceImg.width, faceImg.height, truecolor, availW, rows, fast, args.speed);
  } else if (sixelEnabled && !isDefaultBanner) {
    const meta = await getImageDims(args.image);
    const dims = sixelDims(meta.width, meta.height, availW, rows - 8);
    const img = await loadImageAt(args.image, dims.w, dims.h);
    log(DIM + `  › source: ${img.source}` + RESET);
    log(DIM + `  › render: sixel graphics · full-resolution image · ${availW} cols` + RESET);
    await sleep(fast ? 1 : 150);
    renderSixelImage(img, { cols: availW, row: 6 });
  } else if (sixelEnabled && isDefaultBanner) {
    // Size the face to fit the available terminal height.
    // Total overhead: startRow (6) + card chrome (6) = 12 rows.
    // Pixel height = terminal-rows × cell-height, rounded to a Sixel band (6 px).
    const maxFaceRows = Math.max(8, rows - 12);
    const faceTermRows = Math.min(24, maxFaceRows);
    const SIXEL_BAND = 6;
    const facePixelH = Math.floor(faceTermRows * SIXEL_CELL_H / SIXEL_BAND) * SIXEL_BAND;
    const facePixelW = Math.max(1, Math.round(facePixelH * FACE_ASPECT));
    const faceImg = await loadAvatarImage(facePixelW, facePixelH, 'west');
    log(DIM + `  › source: ${faceImg.source}` + RESET);
    log(DIM + `  › render: sharp terminal banner card (sixel inline photo) · ${availW} cols` + RESET);
    await sleep(fast ? 1 : 150);
    await renderCardWithSixelFace(faceImg, truecolor, availW, rows, fast, args.speed);
  } else {
    log(YELLOW + DIM + `  › no kitty-graphics detected — this terminal can't show the full-res image` + RESET);
    log(YELLOW + DIM + `  › pixel-art fallback below (use Windows Terminal / WezTerm / Ghostty / kitty for the real image)` + RESET);
    const img = await loadImage(args.image, availW);
    let faceImg = undefined;
    if (isDefaultBanner) {
      const faceCols = 44;
      const faceRows = 22;
      const pixelW = faceCols * 2;                           // 88
      const pixelH = truecolor ? faceRows * 3 : faceRows * 4; // 66 sextant, 88 halfblock
      faceImg = await loadAvatarImage(pixelW, pixelH);
    }
    log(DIM + `  › source: ${img.source}` + RESET);
    log(
      DIM +
        `  › render: ${
          isDefaultBanner
            ? 'sharp terminal banner card'
            : truecolor
              ? 'truecolor (24-bit)'
              : '256-color (dithered)'
        } · ${availW} cols` +
        RESET
    );
    await sleep(fast ? 1 : 150);
    await renderImage(img, { truecolor, speed: args.speed, fast, availW, availH: rows, isDefaultBanner, faceImg });
  }

  log();
  await sleep(fast ? 1 : 160);
  await glitchReveal('https://portfolio.utkarshsingh72007.workers.dev/', { truecolor: true, fast });
  await sleep(fast ? 1 : 140);

  log(DIM + '  ▲ hey that’s me — get more info about me' + RESET);
  log();
  if (tty) {
    process.stdout.write(DIM + '  [ press any key to exit ]' + RESET + CLEAR_LINE);
    await waitForKey();
    process.stdout.write('\r' + DIM + YELLOW + '  later, space cadet ✦' + RESET + CLEAR_LINE + '\n');
  } else {
    log(DIM + '  (non-interactive mode, nothing to wait on)' + RESET);
  }
}

const log = (m = '') => process.stdout.write(m + '\n');

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
