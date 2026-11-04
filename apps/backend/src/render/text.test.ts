import { describe, expect, it } from 'vitest';
import { escapeXml, layoutText } from './text.js';

describe('layoutText', () => {
  it('keeps text within the line limit by shrinking the font', () => {
    const b = layoutText('Stop scrolling: meet the most comfortable everyday sneaker', { maxWidth: 600, fontSize: 90, maxLines: 3 });
    expect(b.lines.length).toBeLessThanOrEqual(3);
    expect(b.fontSize).toBeLessThan(90);
  });

  it('shrinks instead of breaking a word mid-way', () => {
    const b = layoutText('Stop scrolling: meet Beard Oil', { maxWidth: 542, fontSize: 92, maxLines: 4 });
    expect(b.lines.some((l) => l.startsWith(':'))).toBe(false);
    expect(b.lines.join(' ')).toBe('Stop scrolling: meet Beard Oil');
  });

  it('truncates with an ellipsis only when even the minimum size cannot fit', () => {
    const b = layoutText('word '.repeat(60), { maxWidth: 300, fontSize: 40, minFontSize: 36, maxLines: 2 });
    expect(b.lines).toHaveLength(2);
    expect(b.lines[1]!.endsWith('…')).toBe(true);
  });

  it('never reports a width wider than the box', () => {
    const b = layoutText('Supercalifragilisticexpialidocious', { maxWidth: 200, fontSize: 60, maxLines: 2 });
    expect(b.width).toBeLessThanOrEqual(200);
  });
});

describe('escapeXml', () => {
  it('escapes markup so scraped text cannot inject SVG', () => {
    expect(escapeXml('<script>"&\'')).toBe('&lt;script&gt;&quot;&amp;&apos;');
  });
});
