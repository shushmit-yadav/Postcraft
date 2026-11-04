import { describe, expect, it } from 'vitest';
import { FORMATS, contentBox, formatsForPlatform, PLATFORMS } from './formats.js';

describe('format registry', () => {
  it('every platform has at least one format', () => {
    for (const p of PLATFORMS) expect(formatsForPlatform(p).length).toBeGreaterThan(0);
  });

  it('declared aspect ratio matches width/height', () => {
    for (const f of Object.values(FORMATS)) {
      const [w, h] = f.aspectRatio.split(':').map(Number) as [number, number];
      expect(f.width / f.height).toBeCloseTo(w / h, 3);
    }
  });

  it('safe content box is positive and inside the frame', () => {
    for (const f of Object.values(FORMATS)) {
      const box = contentBox(f);
      expect(box.width).toBeGreaterThan(f.width / 2);
      expect(box.height).toBeGreaterThan(f.height / 2);
    }
  });

  it('video formats target a duration within their max', () => {
    for (const f of Object.values(FORMATS)) {
      if (f.kind === 'video') expect(f.targetSeconds).toBeLessThanOrEqual(f.maxSeconds);
    }
  });
});
