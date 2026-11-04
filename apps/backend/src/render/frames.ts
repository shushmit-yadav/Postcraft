import sharp from 'sharp';
import { contentBox, type OutputFormat } from '@app/shared';
import { layoutText, svgText } from './text.js';

/**
 * Builds the still layers each scene is made of:
 *  - base: gradient background (from the photo's dominant color) + the product
 *    photo as a rounded card with a soft shadow. Never crops the product shot.
 *  - overlay: transparent PNG with the scene's text, inside the platform safe zone.
 *
 * Overlays report the vertical space their text uses, so the product card can
 * be sized to fill exactly the space left between the text (no overlap).
 */

export const BRAND_COLOR = '#7c3aed';
const CARD_RADIUS = 36;
const GAP = 28; // space between text panels and the product card

const HOOK = { fontSize: 76, maxLines: 3 };
const CAPTION = { fontSize: 56, maxLines: 3 };
const TITLE = { fontSize: 60, maxLines: 2 };

/** A text layer plus the vertical band it occupies: `top` (first used y) and `bottom` (last used y). */
export interface Layer {
  body: string;
  /** Lowest y used by text anchored at the top of the frame (null = none). */
  topEdge: number | null;
  /** Highest y used by text anchored at the bottom of the frame (null = none). */
  bottomEdge: number | null;
}

export interface CardZone {
  top: number;
  bottom: number;
}

const svg = (w: number, h: number, body: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

export const toSvg = (format: OutputFormat, ...layers: Layer[]) =>
  svg(format.width, format.height, layers.map((l) => l.body).join(''));

/** Rounded translucent panel behind a text block. */
function panel(cx: number, y: number, w: number, h: number, fill = '#000', opacity = 0.55, radius = 28) {
  return `<rect x="${Math.round(cx - w / 2)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" rx="${Math.round(radius)}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/**
 * The band between all top text and all bottom text across the given layers.
 * Used for every scene of a video, so the card stays put between crossfades.
 */
export function cardZone(format: OutputFormat, layers: Layer[]): CardZone {
  const box = contentBox(format);
  const tops = layers.map((l) => l.topEdge).filter((v): v is number => v !== null);
  const bottoms = layers.map((l) => l.bottomEdge).filter((v): v is number => v !== null);
  const top = (tops.length ? Math.max(...tops) : box.y) + GAP;
  const bottom = (bottoms.length ? Math.min(...bottoms) : box.y + box.height) - GAP;
  // Never let the card collapse: keep at least 35% of the frame for the product.
  const minH = format.height * 0.35;
  if (bottom - top < minH) {
    const mid = (top + bottom) / 2;
    return { top: mid - minH / 2, bottom: mid + minH / 2 };
  }
  return { top, bottom };
}

// ---------------------------------------------------------------------------
// Text layers
// ---------------------------------------------------------------------------

/** Opening card: brand label + the hook, at the top of the safe area. */
export function introLayer(format: OutputFormat, hook: string, brand?: string): Layer {
  const box = contentBox(format);
  const cx = box.x + box.width / 2;
  const padX = 40;
  const padY = 30;
  const hookBlock = layoutText(hook, { maxWidth: box.width - padX * 2, ...HOOK });
  const brandBlock = brand
    ? layoutText(brand.toUpperCase(), { maxWidth: box.width - padX * 2, fontSize: 30, maxLines: 1 })
    : null;
  const gap = brandBlock ? 18 : 0;
  const innerH = hookBlock.height + (brandBlock ? brandBlock.height + gap : 0);
  const w = Math.max(hookBlock.width, brandBlock?.width ?? 0) + padX * 2;
  const top = box.y + 30;
  const h = innerH + padY * 2;

  let body = panel(cx, top, w, h);
  let y = top + padY;
  if (brandBlock) {
    body += svgText(brandBlock, cx, y, { opacity: 0.8, letterSpacing: 4 });
    y += brandBlock.height + gap;
  }
  body += svgText(hookBlock, cx, y);
  return { body, topEdge: top + h, bottomEdge: null };
}

/** Feature caption near the bottom of the safe area. */
export function captionLayer(format: OutputFormat, text: string): Layer {
  const box = contentBox(format);
  const cx = box.x + box.width / 2;
  const padX = 36;
  const padY = 26;
  const block = layoutText(text, { maxWidth: box.width - padX * 2, ...CAPTION });
  const h = block.height + padY * 2;
  const top = box.y + box.height - h - 30;
  return {
    body: panel(cx, top, block.width + padX * 2, h) + svgText(block, cx, top + padY),
    topEdge: null,
    bottomEdge: top,
  };
}

/** Product name panel at the top (used by the closing card). */
export function titleLayer(format: OutputFormat, title: string): Layer {
  const box = contentBox(format);
  const cx = box.x + box.width / 2;
  const block = layoutText(title, { maxWidth: box.width - 80, ...TITLE });
  const top = box.y + 30;
  const h = block.height + 52;
  return { body: panel(cx, top, block.width + 80, h) + svgText(block, cx, top + 26), topEdge: top + h, bottomEdge: null };
}

/** Price (optional) above a CTA button, at the bottom of the safe area. */
export function ctaLayer(format: OutputFormat, cta: string, price?: string | null): Layer {
  const box = contentBox(format);
  const cx = box.x + box.width / 2;
  const ctaBlock = layoutText(cta, { maxWidth: box.width - 160, fontSize: 58, maxLines: 1 });
  const ctaH = ctaBlock.height + 48;
  const ctaTop = box.y + box.height - ctaH - 30;
  let body = panel(cx, ctaTop, ctaBlock.width + 120, ctaH, BRAND_COLOR, 1, ctaH / 2);
  body += svgText(ctaBlock, cx, ctaTop + 24);
  let topOfBlock = ctaTop;

  if (price) {
    const priceBlock = layoutText(price, { maxWidth: box.width - 80, fontSize: 68, maxLines: 1 });
    const priceH = priceBlock.height + 28;
    const priceTop = ctaTop - priceH - 20;
    body += panel(cx, priceTop, priceBlock.width + 64, priceH, '#000', 0.55, 22);
    body += svgText(priceBlock, cx, priceTop + 14);
    topOfBlock = priceTop;
  }
  return { body, topEdge: null, bottomEdge: topOfBlock };
}

/** Landscape thumbnail: big hook and CTA in the left column (the card goes on the right). */
export function landscapeTextLayer(format: OutputFormat, hook: string, cta: string): Layer {
  const box = contentBox(format);
  const colW = box.width * 0.52;
  const cx = box.x + colW / 2;
  const hookBlock = layoutText(hook, { maxWidth: colW - 40, fontSize: 92, maxLines: 4, lineHeight: 1.08 });
  const ctaBlock = layoutText(cta, { maxWidth: colW - 80, fontSize: 40, maxLines: 1 });
  const total = hookBlock.height + 40 + ctaBlock.height + 36;
  const top = box.y + (box.height - total) / 2;
  let body = panel(cx, top - 24, hookBlock.width + 56, hookBlock.height + 48, '#000', 0.6);
  body += svgText(hookBlock, cx, top);
  const ctaTop = top + hookBlock.height + 40;
  const ctaH = ctaBlock.height + 36;
  body += panel(cx, ctaTop, ctaBlock.width + 80, ctaH, BRAND_COLOR, 1, ctaH / 2);
  body += svgText(ctaBlock, cx, ctaTop + 18);
  return { body, topEdge: null, bottomEdge: null };
}

// ---------------------------------------------------------------------------
// Base frame
// ---------------------------------------------------------------------------

/** Background colors from the photo's dominant color; neutral photos fall back to the brand palette. */
async function backgroundColors(imagePath: string): Promise<[string, string]> {
  const { dominant } = await sharp(imagePath).resize(64, 64, { fit: 'inside' }).stats();
  const { r, g, b } = dominant;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.18) return ['#4c1d95', '#0f172a']; // white/grey product shots: brand gradient
  const shade = (k: number) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  return [shade(0.75), shade(0.25)];
}

/**
 * Renders the background + product card at `width`×`height` (which may be larger than
 * the output for panning; it is cropped later, never scaled, so all positions are in
 * output pixels offset by the margin).
 */
export async function renderBase(
  imagePath: string,
  width: number,
  height: number,
  format: OutputFormat,
  zone: CardZone,
) {
  const landscape = format.width > format.height;
  const box = contentBox(format);
  const offsetX = (width - format.width) / 2;
  const offsetY = (height - format.height) / 2;
  const maxW = Math.round(landscape ? box.width * 0.42 : box.width * 0.94);
  const maxH = Math.round(landscape ? box.height * 0.82 : zone.bottom - zone.top);

  const [c1, c2] = await backgroundColors(imagePath);
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  // A faint, heavily blurred copy of the photo adds texture without muddying the colors.
  const texture = await sharp(imagePath)
    .resize(width, height, { fit: 'cover' })
    .blur(60)
    .removeAlpha()
    .ensureAlpha(0.18)
    .png()
    .toBuffer();
  const background = await sharp(gradient).composite([{ input: texture, blend: 'soft-light' }]).png().toBuffer();

  const fg = await sharp(imagePath).resize(maxW, maxH, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  const fw = fg.info.width;
  const fh = fg.info.height;
  const roundMask = Buffer.from(
    `<svg width="${fw}" height="${fh}"><rect width="${fw}" height="${fh}" rx="${CARD_RADIUS}" fill="#fff"/></svg>`,
  );
  const card = await sharp(fg.data).composite([{ input: roundMask, blend: 'dest-in' }]).png().toBuffer();

  const pad = 60;
  const shadow = await sharp({
    create: { width: fw + pad * 2, height: fh + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${fw}" height="${fh}"><rect width="${fw}" height="${fh}" rx="${CARD_RADIUS}" fill="#000" fill-opacity="0.5"/></svg>`,
        ),
        left: pad,
        top: pad,
      },
    ])
    .blur(28)
    .png()
    .toBuffer();

  // Portrait: card centered in its zone. Landscape: card on the right, text on the left.
  const left = landscape
    ? Math.round(offsetX + box.x + box.width * 0.55 + (box.width * 0.45 - fw) / 2)
    : Math.round((width - fw) / 2);
  const top = landscape
    ? Math.round((height - fh) / 2)
    : Math.round(offsetY + zone.top + (zone.bottom - zone.top - fh) / 2);

  return sharp(background)
    .composite([
      { input: shadow, left: left - pad, top: top - pad + 18 },
      { input: card, left, top },
    ])
    .png()
    .toBuffer();
}
