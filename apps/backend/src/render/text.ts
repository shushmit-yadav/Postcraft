/**
 * Minimal text layout for SVG overlays: word wrapping and auto-shrinking so
 * text always fits its box. Widths are estimated from average glyph width,
 * which is reliable enough for a bold sans-serif at display sizes.
 */

export const FONT_FAMILY = "'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif";
const AVG_CHAR_EM = 0.6; // DejaVu Sans Bold averages ~0.6em per glyph

export interface TextBlock {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  width: number;
  height: number;
}

export function layoutText(
  text: string,
  opts: { maxWidth: number; fontSize: number; minFontSize?: number; maxLines: number; lineHeight?: number },
): TextBlock {
  const minSize = opts.minFontSize ?? Math.round(opts.fontSize * 0.6);
  let size = opts.fontSize;
  let lines = wrap(text, charsPerLine(opts.maxWidth, size));
  // Shrink while the text needs too many lines, or a single word is wider than the box
  // (otherwise it would be broken mid-word). Words are only hard-broken at the minimum size.
  const longestWord = Math.max(...text.split(/\s+/).map((w) => w.length));
  const tooBig = () => lines.length > opts.maxLines || longestWord > charsPerLine(opts.maxWidth, size);
  while (tooBig() && size > minSize) {
    size = Math.max(minSize, Math.round(size * 0.9));
    lines = wrap(text, charsPerLine(opts.maxWidth, size));
  }
  if (lines.length > opts.maxLines) {
    lines = lines.slice(0, opts.maxLines);
    lines[lines.length - 1] = `${lines.at(-1)!.replace(/[\s,.;:!?…]+$/, '')}…`;
  }
  const lineHeight = Math.round(size * (opts.lineHeight ?? 1.18));
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    lines,
    fontSize: size,
    lineHeight,
    width: Math.min(opts.maxWidth, Math.ceil(longest * size * AVG_CHAR_EM)),
    height: lineHeight * lines.length,
  };
}

const charsPerLine = (width: number, size: number) => Math.max(4, Math.floor(width / (size * AVG_CHAR_EM)));

function wrap(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    // Hard-break words longer than a full line.
    for (const part of word.match(new RegExp(`.{1,${maxChars}}`, 'gu')) ?? [word]) {
      if (!line) line = part;
      else if (line.length + 1 + part.length <= maxChars) line += ` ${part}`;
      else {
        lines.push(line);
        line = part;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/** SVG <text> element for a laid-out block, horizontally centered on cx, top at y. */
export function svgText(
  block: TextBlock,
  cx: number,
  y: number,
  opts: { fill?: string; weight?: number; opacity?: number; letterSpacing?: number } = {},
) {
  const baseline = y + block.fontSize * 0.95;
  const tspans = block.lines
    .map((l, i) => `<tspan x="${cx}" y="${Math.round(baseline + i * block.lineHeight)}">${escapeXml(l)}</tspan>`)
    .join('');
  return `<text font-family="${FONT_FAMILY}" font-size="${block.fontSize}" font-weight="${opts.weight ?? 700}" fill="${opts.fill ?? '#ffffff'}" fill-opacity="${opts.opacity ?? 1}" letter-spacing="${opts.letterSpacing ?? 0}" text-anchor="middle">${tspans}</text>`;
}
