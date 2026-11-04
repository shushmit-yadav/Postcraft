import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import type { Script, VideoFormat } from '@app/shared';
import { captionLayer, cardZone, ctaLayer, introLayer, renderBase, titleLayer, toSvg, type Layer } from './frames.js';
import { runFfmpeg } from './ffmpeg.js';

export const INTRO_SECONDS = 2.6;
export const OUTRO_SECONDS = 3;
const XFADE_SECONDS = 0.4;
/** Base frames are rendered slightly larger than the output so they can slowly pan. */
const PAN_MARGIN_X = 1.08;
const PAN_MARGIN_Y = 1.02;

export interface VideoRenderInput {
  format: VideoFormat;
  script: Script;
  title: string;
  brand?: string;
  price?: string | null;
  heroIndex: number;
  imagePaths: string[];
  workDir: string;
  signal: AbortSignal;
  onProgress: (fraction: number) => Promise<void> | void;
}

interface Segment {
  imageIndex: number;
  layers: Layer[];
  duration: number;
}

const even = (n: number) => Math.round(n / 2) * 2;

/**
 * Timeline: intro (hook) → one scene per script scene → outro (price + CTA).
 * Each segment = slowly panning base frame + text overlay that fades in,
 * joined with crossfades. Encoded as H.264/AAC with faststart for web playback.
 */
export async function renderVideo(input: VideoRenderInput) {
  const { format, script, imagePaths, workDir, signal } = input;
  const n = imagePaths.length;
  const hero = input.heroIndex % n;

  const segments: Segment[] = [
    { imageIndex: hero, layers: [introLayer(format, script.hook, input.brand)], duration: INTRO_SECONDS },
    ...script.scenes.map((s) => ({ imageIndex: s.imageIndex % n, layers: [captionLayer(format, s.text)], duration: s.durationSec })),
    {
      imageIndex: hero,
      layers: [titleLayer(format, input.title), ctaLayer(format, script.cta, input.price)],
      duration: OUTRO_SECONDS,
    },
  ];
  // One card zone for the whole video (measured from the real text), so the product
  // card never jumps between scenes and never sits under any text.
  const zone = cardZone(format, segments.flatMap((s) => s.layers));
  fitToMaxDuration(segments, format.maxSeconds);
  const total = segments.reduce((sum, s) => sum + s.duration, 0) - XFADE_SECONDS * (segments.length - 1);

  // Still layers (each base image is rendered once and reused).
  const bw = even(format.width * PAN_MARGIN_X);
  const bh = even(format.height * PAN_MARGIN_Y);
  const basePaths = new Map<number, string>();
  for (const seg of segments) {
    if (basePaths.has(seg.imageIndex)) continue;
    signal.throwIfAborted();
    const p = path.join(workDir, `base-${seg.imageIndex}.png`);
    await fs.writeFile(p, await renderBase(imagePaths[seg.imageIndex]!, bw, bh, format, zone));
    basePaths.set(seg.imageIndex, p);
  }
  const overlayPaths = await Promise.all(
    segments.map(async (seg, i) => {
      const p = path.join(workDir, `overlay-${i}.png`);
      await sharp(toSvg(format, ...seg.layers)).png().toFile(p);
      return p;
    }),
  );
  await input.onProgress(0.1);

  // Poster/thumbnail: the intro frame, rendered as a still.
  const thumbnailPath = path.join(workDir, 'thumbnail.jpg');
  await sharp(basePaths.get(hero)!)
    .extract({ left: Math.round((bw - format.width) / 2), top: Math.round((bh - format.height) / 2), width: format.width, height: format.height })
    .composite([{ input: overlayPaths[0]! }])
    .jpeg({ quality: 86 })
    .toFile(thumbnailPath);

  // FFmpeg inputs: per segment a looping base still and a looping overlay still.
  const args: string[] = [];
  segments.forEach((seg, i) => {
    // Single-frame inputs; the loop filter repeats the decoded frame (decoding once is much faster).
    args.push('-protocol_whitelist', 'file', '-i', basePaths.get(seg.imageIndex)!);
    args.push('-protocol_whitelist', 'file', '-i', overlayPaths[i]!);
  });
  const audioIndex = segments.length * 2;
  args.push('-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const W = format.width;
  const H = format.height;
  const filters: string[] = [];
  segments.forEach((seg, i) => {
    const d = seg.duration.toFixed(3);
    // Alternate pan direction per scene for a bit of motion.
    const x = i % 2 === 0 ? `(iw-ow)*t/${d}` : `(iw-ow)*(1-t/${d})`;
    const y = `(ih-oh)/2`;
    const frames = Math.round(seg.duration * format.fps);
    const hold = `loop=loop=${frames - 1}:size=1:start=0,setpts=N/${format.fps}/TB`;
    filters.push(`[${i * 2}:v]${hold},crop=${W}:${H}:x='${x}':y='${y}',setsar=1[b${i}]`);
    filters.push(`[${i * 2 + 1}:v]format=rgba,${hold},fade=t=in:st=0.15:d=0.45:alpha=1[o${i}]`);
    filters.push(`[b${i}][o${i}]overlay=0:0:shortest=1,format=yuv420p,settb=AVTB[s${i}]`);
  });
  let last = 's0';
  let offset = 0;
  for (let i = 1; i < segments.length; i++) {
    offset += segments[i - 1]!.duration - XFADE_SECONDS;
    const out = i === segments.length - 1 ? 'v' : `x${i}`;
    filters.push(`[${last}][s${i}]xfade=transition=fade:duration=${XFADE_SECONDS}:offset=${offset.toFixed(3)}[${out}]`);
    last = out;
  }
  if (segments.length === 1) filters.push('[s0]null[v]');

  const outputPath = path.join(workDir, 'output.mp4');
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', `${audioIndex}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(format.fps), '-g', String(format.fps * 2),
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-t', total.toFixed(3),
    outputPath,
  );

  await runFfmpeg(args, {
    signal,
    totalSeconds: total,
    onProgress: (f) => void input.onProgress(0.1 + f * 0.9),
  });

  return { outputPath, thumbnailPath, durationSec: total };
}

/** Shrinks scene durations proportionally if the timeline would exceed the format's maximum. */
function fitToMaxDuration(segments: Segment[], maxSeconds: number) {
  const total = segments.reduce((s, x) => s + x.duration, 0) - XFADE_SECONDS * (segments.length - 1);
  if (total <= maxSeconds) return;
  const scenes = segments.slice(1, -1);
  const fixed = total - scenes.reduce((s, x) => s + x.duration, 0);
  const factor = Math.max(0.1, (maxSeconds - fixed) / scenes.reduce((s, x) => s + x.duration, 0));
  for (const s of scenes) s.duration = Math.max(1.5, s.duration * factor);
}
