import { ScriptSchema, type Script, type Tone } from '@app/shared';
import type { AnalysisData, ProductData } from '../../db/schema.js';
import { formatPrice } from '../../lib/price.js';
import type { AnalyzeInput, ContentProvider, ScriptInput } from './types.js';

/**
 * Deterministic, offline content generation built from the scraped product data.
 * It is the SIMULATED part of the app: no model is called. The same input
 * always produces the same output, which also makes it useful in tests.
 */
export class MockProvider implements ContentProvider {
  readonly name = 'mock' as const;

  async analyze({ product }: AnalyzeInput): Promise<AnalysisData> {
    const category = product.category?.split(/[>/,]/).pop()?.trim().toLowerCase() || guessCategory(product);
    return {
      category,
      sellingPoints: extractSellingPoints(product.description),
      audience: AUDIENCE[category] ?? 'online shoppers',
      heroImageIndex: 0,
    };
  }

  async writeScript({ product, analysis, tone, imageCount, sceneSeconds }: ScriptInput): Promise<Script> {
    const name = shortName(product.title);
    const seed = hash(product.title);
    const pick = <T>(list: readonly T[], offset = 0) => list[(seed + offset) % list.length]!;

    const hook = fit(pick(HOOKS[tone]).replace('{name}', name).replace('{category}', analysis.category), 70);

    const points = [...analysis.sellingPoints];
    for (const generic of GENERIC_POINTS[tone]) {
      if (points.length >= 3) break;
      points.push(generic);
    }

    const sceneCount = Math.max(1, Math.min(3, Math.floor(sceneSeconds / 2.5)));
    const durationSec = round1(Math.min(6, Math.max(2, sceneSeconds / sceneCount)));
    const scenes = points.slice(0, sceneCount).map((text, i) => ({
      text: fit(text, 80),
      imageIndex: imageCount > 1 ? (i + 1) % imageCount : 0,
      durationSec,
    }));

    const priceText = formatPrice(product.price, product.currency);
    const cta = fit(pick(CTAS[tone], 1), 30);
    const caption = [
      hook,
      '',
      product.description ? fit(firstSentences(product.description, 2), 300) : `${name}: ${points[0]}.`,
      '',
      priceText ? `${cta} (${priceText}). Link in bio.` : `${cta}. Link in bio.`,
    ].join('\n');

    return ScriptSchema.parse({ hook, scenes, cta, caption, hashtags: hashtags(product, analysis) });
  }
}

const HOOKS: Record<Tone, readonly string[]> = {
  energetic: ['Stop scrolling: meet {name}', 'Your new favorite {category} is here', 'This changes everything'],
  friendly: ['Say hello to {name}', 'Meet your new everyday favorite', 'We think you will love this one'],
  premium: ['Crafted for those who notice', 'Quiet luxury: {name}', 'Designed without compromise'],
  playful: ['Okay, we are obsessed', 'Your cart is about to thank you', 'Main character energy, unlocked'],
};

const CTAS: Record<Tone, readonly string[]> = {
  energetic: ['Grab yours now', 'Shop now', 'Get it today'],
  friendly: ['Find yours today', 'Take a look', 'Treat yourself'],
  premium: ['Discover more', 'Explore the collection', 'Own yours'],
  playful: ['Add to cart', 'Go on, treat yourself', 'You know you want it'],
};

const GENERIC_POINTS: Record<Tone, readonly string[]> = {
  energetic: ['Built for every day', 'Looks good, works harder', 'Loved by customers'],
  friendly: ['Made to make life easier', 'Simple, useful, lovely', 'A little everyday upgrade'],
  premium: ['Exceptional materials', 'Timeless design', 'Made to last'],
  playful: ['Instant mood boost', 'Compliments guaranteed', 'Zero regrets'],
};

const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['shoes', /\b(shoe|sneaker|runner|boot|sandal|trainer)s?\b/i],
  ['apparel', /\b(shirt|tee|hoodie|jacket|dress|pants|jeans|sweater|sock)s?\b/i],
  ['beauty', /\b(serum|cream|lipstick|skincare|moisturi[sz]er|perfume|fragrance)s?\b/i],
  ['electronics', /\b(headphone|earbud|speaker|phone|laptop|camera|charger|watch)s?\b/i],
  ['home', /\b(mug|lamp|chair|table|candle|pillow|sofa|vase|kitchen)s?\b/i],
  ['books', /\b(book|novel|paperback|hardcover)s?\b/i],
  ['food', /\b(coffee|tea|chocolate|snack|sauce)s?\b/i],
  ['accessories', /\b(bag|backpack|wallet|sunglasses|bracelet|necklace|ring)s?\b/i],
];

const AUDIENCE: Record<string, string> = {
  shoes: 'active people who value comfort',
  apparel: 'style-conscious shoppers',
  beauty: 'skincare and beauty lovers',
  electronics: 'tech enthusiasts',
  home: 'people who love a cozy home',
  books: 'readers',
  food: 'food lovers',
  accessories: 'style-conscious shoppers',
};

function guessCategory(p: ProductData) {
  const text = `${p.title} ${p.description ?? ''}`;
  return CATEGORY_KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? 'product';
}

function extractSellingPoints(description?: string): string[] {
  if (!description) return [];
  return description
    .split(/(?<=[.!?])\s+|\s*[•·|\n]\s*/)
    .map((s) => s.replace(/[.!?]+$/, '').trim())
    .filter((s) => s.length >= 12 && s.length <= 70 && !/https?:|@|\d{5,}/.test(s))
    .slice(0, 3);
}

function shortName(title: string) {
  return fit(title.replace(/\s*[([].*?[)\]]\s*/g, ' ').trim(), 32);
}

/** Truncates at a word boundary so text never exceeds what the layout (and schema) allow. */
function fit(text: string, max: number) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trimEnd()}…`;
}

function firstSentences(text: string, n: number) {
  return text.split(/(?<=[.!?])\s+/).slice(0, n).join(' ');
}

function hashtags(p: ProductData, a: AnalysisData) {
  const words = [a.category, p.brand, ...p.title.split(/\s+/)]
    .filter((w): w is string => !!w)
    .map((w) => w.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  return [...new Set([...words, 'musthave', 'shopping'])].slice(0, 8).map((w) => `#${w}`);
}

const STOP_WORDS = new Set(['with', 'from', 'this', 'that', 'your', 'product', 'pack', 'size', 'free', 'sale']);

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
