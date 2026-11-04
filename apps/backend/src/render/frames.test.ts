import { describe, expect, it } from 'vitest';
import { FORMATS } from '@app/shared';
import { captionLayer, cardZone, ctaLayer, introLayer, titleLayer } from './frames.js';

describe('cardZone', () => {
  it('keeps the product card clear of all text, even with long captions', () => {
    const f = FORMATS.ig_reel;
    const long = 'It is hard to imagine a world without this book, the poems are wonderful and funny';
    const layers = [
      introLayer(f, 'Stop scrolling: meet A Light in the Attic', 'Books Store'),
      captionLayer(f, long),
      titleLayer(f, 'A Light in the Attic'),
      ctaLayer(f, 'Shop now', '$51.77'),
    ];
    const zone = cardZone(f, layers);
    const maxTop = Math.max(...layers.map((l) => l.topEdge ?? 0));
    const minBottom = Math.min(...layers.map((l) => l.bottomEdge ?? Infinity));
    expect(zone.top).toBeGreaterThan(maxTop);
    expect(zone.bottom).toBeLessThan(minBottom);
  });
});
