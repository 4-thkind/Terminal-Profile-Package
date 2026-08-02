export function hasTrueColor(): boolean {
  try {
    if (process.stdout.hasColors && process.stdout.hasColors(16_000_000)) return true;
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32' && process.stdout.isTTY) return true;
  const env = process.env;
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return true;
  if (
    env.WT_SESSION ||
    env.KONSOLE_VERSION ||
    env.TERM_PROGRAM === 'iTerm.app' ||
    env.TERM_PROGRAM === 'Hyper' ||
    env.TERM_PROGRAM === 'ghostty' ||
    env.VTE_VERSION
  )
    return true;
  if (env.TERM && env.TERM.includes('truecolor')) return true;
  return false;
}

export function rgbForeground(r: number, g: number, b: number, tc: boolean): string {
  if (tc) return `\x1b[38;2;${r};${g};${b}m`;
  return `\x1b[38;5;${to256(r, g, b)}m`;
}

export function rgbBackground(r: number, g: number, b: number, tc: boolean): string {
  if (tc) return `\x1b[48;2;${r};${g};${b}m`;
  return `\x1b[48;5;${to256(r, g, b)}m`;
}

export function gradientColor(t: number, tc: boolean): string {
  if (tc) {
    const r = Math.round(0 + 255 * t);
    const g = Math.round(255 - 255 * Math.abs(2 * t - 1));
    const b = Math.round(180 - 180 * t);
    return `\x1b[38;2;${r};${g};${b}m`;
  }
  const colors = [82, 46, 40, 44, 45, 51];
  const i = Math.min(colors.length - 1, Math.floor(t * colors.length));
  return `\x1b[38;5;${colors[i]}m`;
}

function to256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(232 + ((r - 8) / 247) * 23);
  }
  const ri = Math.min(5, Math.round(r / 51));
  const gi = Math.min(5, Math.round(g / 51));
  const bi = Math.min(5, Math.round(b / 51));
  return 16 + 36 * ri + 6 * gi + bi;
}
