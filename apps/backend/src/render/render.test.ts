import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORMATS, type Script } from '@app/shared';
import { probe } from './ffmpeg.js';
import { renderImage } from './image.js';
import { renderVideo } from './video.js';

// Integration test: real sharp + FFmpeg, asserting the files meet the platform format rules.
let dir: string;
let photo: string;
const script: Script = {
  hook: 'Stop scrolling: meet the Sunrise Mug',
  scenes: [{ text: 'Keeps coffee hot for six hours', imageIndex: 0, durationSec: 2 }],
  cta: 'Shop now',
  caption: 'caption',
  hashtags: ['#mug'],
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'render-test-'));
  photo = path.join(dir, 'photo.jpg');
  await sharp({ create: { width: 800, height: 800, channels: 3, background: '#ea580c' } }).jpeg().toFile(photo);
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe('rendered output meets platform format rules', () => {
  it('ig_reel: 1080x1920 H.264 yuv420p with audio, within max duration', async () => {
    const f = FORMATS.ig_reel;
    const out = await renderVideo({
      format: f, script, title: 'Sunrise Mug', price: '$24.00', heroIndex: 0,
      imagePaths: [photo], workDir: dir, signal: AbortSignal.timeout(120_000), onProgress: () => {},
    });
    const p = await probe(out.outputPath);
    expect([p.width, p.height, p.codec, p.pixFmt, p.hasAudio]).toEqual([1080, 1920, 'h264', 'yuv420p', true]);
    expect(p.durationSec).toBeGreaterThan(4);
    expect(p.durationSec!).toBeLessThanOrEqual(f.maxSeconds);
    expect(Math.abs(p.durationSec! - out.durationSec)).toBeLessThan(0.2);
  }, 120_000);

  it.each(['ig_feed', 'yt_thumb'] as const)('%s: PNG at exact size', async (id) => {
    const f = FORMATS[id];
    const { outputPath } = await renderImage({ format: f, script, heroPath: photo, workDir: dir, price: '$24.00' });
    const m = await sharp(outputPath).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', f.width, f.height]);
  }, 60_000);
});
