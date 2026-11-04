/**
 * Dev tool: renders every format from a sample image without the database or queue.
 *   npm run render:sample -w @app/backend -- [path/to/product.jpg] [outDir]
 * Useful for tuning layouts and measuring render time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FORMATS, type Script } from '@app/shared';
import { probe } from '../src/render/ffmpeg.js';
import { renderImage } from '../src/render/image.js';
import { renderVideo } from '../src/render/video.js';

const [imageArg, outArg] = process.argv.slice(2);
const outDir = path.resolve(outArg ?? './data/samples');
await fs.mkdir(outDir, { recursive: true });

let imagePath = imageArg ? path.resolve(imageArg) : path.join(outDir, 'sample-product.png');
if (!imageArg) {
  // Synthetic "product shot": a colored object on a light background.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
    <defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#ea580c"/></radialGradient></defs>
    <rect width="1200" height="1200" fill="#f1f5f9"/><ellipse cx="600" cy="1000" rx="330" ry="40" fill="#cbd5e1"/>
    <rect x="340" y="300" width="520" height="680" rx="70" fill="url(#g)"/><rect x="860" y="430" width="140" height="300" rx="60" fill="none" stroke="#ea580c" stroke-width="44"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(imagePath);
}

const script: Script = {
  hook: 'Stop scrolling: meet the Sunrise Mug',
  scenes: [
    { text: 'Keeps coffee hot for 6 hours', imageIndex: 0, durationSec: 3 },
    { text: 'Dishwasher safe ceramic with a soft-touch glaze', imageIndex: 0, durationSec: 3 },
    { text: 'Loved by 10,000+ customers', imageIndex: 0, durationSec: 3 },
  ],
  cta: 'Grab yours now',
  caption: 'Sample caption',
  hashtags: ['#mug'],
};

for (const format of Object.values(FORMATS)) {
  const workDir = await fs.mkdtemp(path.join(outDir, `work-${format.id}-`));
  const t0 = Date.now();
  let output: string;
  if (format.kind === 'video') {
    const r = await renderVideo({
      format, script, title: 'Sunrise Ceramic Mug', brand: 'Acme Home', price: '$24.00', heroIndex: 0,
      imagePaths: [imagePath], workDir, signal: AbortSignal.timeout(300_000), onProgress: () => {},
    });
    output = path.join(outDir, `${format.id}.mp4`);
    await fs.rename(r.outputPath, output);
    await fs.rename(r.thumbnailPath, path.join(outDir, `${format.id}-thumb.jpg`));
    const p = await probe(output);
    console.log(`${format.id.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${p.width}x${p.height} ${p.codec} ${p.pixFmt} ${p.durationSec?.toFixed(2)}s audio=${p.hasAudio}`);
  } else {
    const r = await renderImage({ format, script, brand: 'Acme Home', price: '$24.00', heroPath: imagePath, workDir });
    output = path.join(outDir, `${format.id}.png`);
    await fs.rename(r.outputPath, output);
    const m = await sharp(output).metadata();
    console.log(`${format.id.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${m.width}x${m.height} ${m.format}`);
  }
  await fs.rm(workDir, { recursive: true, force: true });
}
console.log(`\nWrote samples to ${outDir}`);
