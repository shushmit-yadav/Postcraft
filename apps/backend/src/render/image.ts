import path from 'node:path';
import sharp from 'sharp';
import type { ImageFormat, Script } from '@app/shared';
import { cardZone, ctaLayer, introLayer, landscapeTextLayer, renderBase, toSvg } from './frames.js';

/** Static post: gradient background + product card + hook and CTA, as a PNG at exact format size. */
export async function renderImage(input: {
  format: ImageFormat;
  script: Script;
  brand?: string;
  price?: string | null;
  heroPath: string;
  workDir: string;
}) {
  const { format, script } = input;
  const layers =
    format.width > format.height
      ? [landscapeTextLayer(format, script.hook, script.cta)]
      : [introLayer(format, script.hook, input.brand), ctaLayer(format, script.cta, input.price)];
  const base = await renderBase(input.heroPath, format.width, format.height, format, cardZone(format, layers));
  const outputPath = path.join(input.workDir, 'output.png');
  await sharp(base).composite([{ input: toSvg(format, ...layers) }]).png({ compressionLevel: 8 }).toFile(outputPath);
  return { outputPath };
}
