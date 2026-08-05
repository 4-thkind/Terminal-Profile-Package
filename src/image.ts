import sharp from 'sharp';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLED_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'banner.jpg');
const BUNDLED_FACE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'night.jpg');

export interface LoadedImage {
  width: number;
  height: number;
  pixels: Buffer;
  channels: number;
  source: string;
}

export interface LoadedPNG {
  png: Buffer;
  width: number;
  height: number;
  source: string;
}

function expandPath(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function defaultCandidates(): string[] {
  const pics = path.join(os.homedir(), 'Pictures');
  return [
    path.join(pics, 'Camera Roll', 'banner(1).jpg'),
    path.join(pics, 'Camera Roll', 'banner.jpg'),
    path.join(pics, 'banner(1).jpg'),
    path.join(pics, 'banner.jpg'),
  ];
}

function candidates(customPath?: string): string[] {
  return customPath
    ? [expandPath(customPath), ...defaultCandidates(), BUNDLED_IMAGE]
    : [...defaultCandidates(), BUNDLED_IMAGE];
}

async function resolveSource(customPath?: string): Promise<string> {
  let lastErr: unknown = null;
  for (const file of candidates(customPath)) {
    try {
      if (!fs.existsSync(file)) continue;
      const meta = await sharp(file).metadata();
      if (!meta.width || !meta.height) continue;
      return file;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not load any image. ${lastErr ? String(lastErr) : ''}`);
}

export async function loadImage(customPath: string | undefined, targetWidth: number): Promise<LoadedImage> {
  const file = await resolveSource(customPath);
  // Each sextant cell in the block-art fallback covers 2 pixel columns (2x3 grid),
  // so load at 2x the requested width for full horizontal resolution.
  const { data, info } = await sharp(file)
    .resize({ width: targetWidth * 2, withoutEnlargement: true, kernel: 'lanczos3' })
    .sharpen({ sigma: 1, m1: 0.4, m2: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data, channels: info.channels, source: file };
}

/** Read an image's intrinsic dimensions without decoding pixel data. */
export async function getImageDims(customPath?: string): Promise<{ width: number; height: number; source: string }> {
  const file = await resolveSource(customPath);
  const meta = await sharp(file).metadata();
  return { width: meta.width ?? 1, height: meta.height ?? 1, source: file };
}

/** Load an image resized to an exact pixel size (used by the Sixel renderer). */
export async function loadImageAt(
  customPath: string | undefined,
  width: number,
  height?: number
): Promise<LoadedImage> {
  const file = await resolveSource(customPath);
  const { data, info } = await sharp(file)
    .resize({ width, height, withoutEnlargement: true, kernel: 'lanczos3' })
    .sharpen({ sigma: 1, m1: 0.4, m2: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data, channels: info.channels, source: file };
}

export async function loadPNG(customPath: string | undefined, maxWidth: number): Promise<LoadedPNG> {
  const file = await resolveSource(customPath);
  const meta = await sharp(file).metadata();
  const srcW = meta.width ?? maxWidth;
  const srcH = meta.height ?? 1;
  const w = Math.min(srcW, maxWidth);
  const png = await sharp(file)
    .resize({ width: w, withoutEnlargement: true, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const out = await sharp(png).metadata();
  return {
    png,
    width: out.width ?? w,
    height: out.height ?? Math.round((w * srcH) / srcW),
    source: file,
  };
}

export async function loadAvatarImage(
  pixelW: number,
  pixelH: number,
  position: 'centre' | 'west' | 'east' = 'centre'
): Promise<LoadedImage> {
  const file = fs.existsSync(BUNDLED_FACE) ? BUNDLED_FACE : BUNDLED_IMAGE;

  const { data, info } = await sharp(file)
    .flatten({ background: { r: 0, g: 0, b: 0 } })   // RGBA → RGB
    .resize({ width: pixelW, height: pixelH, fit: 'cover', position })
    .sharpen({ sigma: 0.8, m1: 0.3, m2: 0.8 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { width: info.width, height: info.height, pixels: data, channels: info.channels, source: file };
}

/** Load face image as a high-res PNG buffer for Kitty inline rendering. */
export async function loadAvatarPNG(maxDim: number, aspect?: number): Promise<LoadedPNG> {
  const file = fs.existsSync(BUNDLED_FACE) ? BUNDLED_FACE : BUNDLED_IMAGE;

  let pipeline = sharp(file).flatten({ background: { r: 0, g: 0, b: 0 } });

  if (aspect) {
    const meta = await sharp(file).metadata();
    const srcW = meta.width ?? maxDim;
    const srcH = meta.height ?? maxDim;
    const cropW = Math.round(srcH * aspect);
    if (cropW < srcW) pipeline = pipeline.extract({ left: 0, top: 0, width: cropW, height: srcH });
  }

  const png = await pipeline
    .resize({ width: maxDim, height: maxDim, fit: 'inside' })
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  return {
    png,
    width: meta.width ?? maxDim,
    height: meta.height ?? maxDim,
    source: file,
  };
}
