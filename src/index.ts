#!/usr/bin/env node
import { loadAvatarImage, loadAvatarPNG, loadImage, loadPNG, getImageDims, loadImageAt } from './image.js';

import { hasTrueColor } from './color.js';
import { renderImage, glitchReveal, waitForKey, sleep, RESET, CLEAR_LINE, BOLD, DIM, CYAN, YELLOW } from './anim.js';

interface CliArgs {
  image?: string;
  width?: number;
  speed: number;
  colors?: 'truecolor' | '256';
  fast: boolean;
  help: boolean;
}

/** Portrait crop ratio (w/h) applied to the face so it fits the card panel without dominating the text. */
const FACE_ASPECT = 0.75;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { width: undefined, speed: 22, colors: undefined, fast: false, help: false };
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
    `  ${CYAN}--fast${RESET}             skip animation delays`,
    `  ${CYAN}--help, -h${RESET}         show this help`,
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



  if (!isDefaultBanner) {
    // Custom image mode
    const img = await loadImage(args.image, availW);
    log(DIM + `  › source: ${img.source}` + RESET);
    log(DIM + `  › render: ${truecolor ? 'truecolor (24-bit)' : '256-color (dithered)'} high-res block art · ${availW} cols` + RESET);
    await sleep(fast ? 1 : 150);
    await renderImage(img, { truecolor, speed: args.speed, fast, availW, availH: rows, isDefaultBanner: false });
  } else {
    // Default banner mode: Render face.png inside the card
    const faceCols = 36;
    const faceRows = 26;
    const pixelW = faceCols * 2;                           // 72
    const pixelH = truecolor ? faceRows * 3 : faceRows * 4; // 78 sextant, 104 halfblock
    
    const faceImg = await loadAvatarImage(pixelW, pixelH);
    log(DIM + `  › source: ${faceImg.source}` + RESET);
    log(
      DIM +
        `  › render: ${
          truecolor ? 'truecolor (24-bit)' : '256-color (dithered)'
        } terminal banner card · ${availW} cols` +
        RESET
    );
    await sleep(fast ? 1 : 150);
    
    // Render the text card WITH the image inside it
    await renderImage(null as any, { truecolor, speed: args.speed, fast, availW, availH: rows, isDefaultBanner: true, faceImg });
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
