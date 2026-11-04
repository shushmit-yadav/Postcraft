import * as cheerio from 'cheerio';

export interface ParsedProduct {
  title: string | null;
  description: string | null;
  brand: string | null;
  price: string | null;
  currency: string | null;
  category: string | null;
  /** Absolute image URLs, best candidates first. */
  imageUrls: string[];
  /** Which source supplied the core data; useful for logs and debugging. */
  source: 'json-ld' | 'microdata' | 'opengraph' | 'html';
}

type Json = Record<string, unknown>;

/**
 * Extracts product facts from an HTML page. Order of trust:
 *   1. schema.org Product JSON-LD (what most stores emit for Google Shopping)
 *   2. schema.org Product microdata (itemprop attributes in the HTML)
 *   3. OpenGraph / Twitter meta tags (what link previews use; often site-wide, so ranked lower)
 *   4. Plain HTML (<title>, meta description, large <img> tags)
 * Pure function: no network, easy to test with fixture HTML.
 */
export function parseProductPage(html: string, pageUrl: string): ParsedProduct {
  const $ = cheerio.load(html);
  const meta = (key: string) =>
    clean($(`meta[property="${key}"]`).attr('content') ?? $(`meta[name="${key}"]`).attr('content'));

  const ld = findJsonLdProduct($) ?? findMicrodataProduct($);
  const images: string[] = [];
  const addImage = (src: unknown) => {
    for (const s of toImageList(src)) {
      const abs = absolutize(s, pageUrl);
      if (abs && !images.includes(abs)) images.push(abs);
    }
  };

  addImage(ld?.image);
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').each(
    (_, el) => addImage($(el).attr('content')),
  );
  if (images.length < 3) {
    // Fallback: <img> tags. Ones that look like product photos (by their own or their
    // container's class/id, or a large declared width) go first; the rest follow.
    // Tiny icons and logos are dropped later by the minimum-size check on download.
    const preferred: string[] = [];
    const others: string[] = [];
    $('img').each((_, el) => {
      const img = $(el);
      const src =
        largestFromSrcset(img.attr('srcset') ?? img.attr('data-srcset')) ?? img.attr('data-src') ?? img.attr('src');
      if (!src) return;
      const containers = img
        .parents()
        .slice(0, 4)
        .map((_, p) => `${$(p).attr('class') ?? ''} ${$(p).attr('id') ?? ''}`)
        .get()
        .join(' ');
      const hint = `${img.attr('class') ?? ''} ${img.attr('id') ?? ''} ${containers} ${src}`.toLowerCase();
      const width = Number(img.attr('width') ?? 0);
      (width >= 400 || /product|gallery|hero|main|zoom|carousel|slide/.test(hint) ? preferred : others).push(src);
    });
    [...preferred, ...others].slice(0, 8).forEach(addImage);
  }

  const offers = firstOf(ld?.offers);
  const price = clean(asText(offers?.price ?? offers?.lowPrice)) ?? meta('product:price:amount') ?? meta('og:price:amount');
  const currency = clean(asText(offers?.priceCurrency)) ?? meta('product:price:currency') ?? meta('og:price:currency');

  const title = cleanTitle(
    clean(asText(ld?.name)) ?? meta('og:title') ?? meta('twitter:title') ?? clean($('h1').first().text()) ?? clean($('title').text()),
  );
  const description =
    clean(stripHtml(asText(ld?.description))) ?? meta('og:description') ?? meta('description') ?? null;

  return {
    title,
    description: description ? truncate(description, 1200) : null,
    brand: clean(asText(nameOf(ld?.brand))) ?? meta('og:site_name'),
    price,
    currency,
    category: clean(asText(nameOf(ld?.category))),
    imageUrls: images.filter(isLikelyPhoto).slice(0, 8),
    source: ld ? ((ld['@source'] as 'json-ld' | 'microdata' | undefined) ?? 'json-ld') : meta('og:title') ? 'opengraph' : 'html',
  };
}

function findJsonLdProduct($: cheerio.CheerioAPI): Json | null {
  const candidates: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collect(JSON.parse($(el).text()), candidates);
    } catch {
      // Malformed JSON-LD is common; ignore that block.
    }
  });
  const isProduct = (n: Json) => {
    const t = n['@type'];
    const types = Array.isArray(t) ? t : [t];
    return types.some((x) => x === 'Product' || x === 'ProductGroup' || x === 'IndividualProduct');
  };
  return candidates.find(isProduct) ?? null;
}

/**
 * Reads schema.org Product microdata into the same shape as a JSON-LD node,
 * so the rest of the parser doesn't care which one the page used.
 */
function findMicrodataProduct($: cheerio.CheerioAPI): Json | null {
  const scope = $('[itemscope][itemtype*="schema.org/Product"]').first();
  if (!scope.length) return null;
  const prop = (name: string) => {
    const el = scope.find(`[itemprop="${name}"]`).first();
    if (!el.length) return undefined;
    return el.attr('content') ?? el.attr('src') ?? el.attr('href') ?? el.text();
  };
  const images = scope
    .find('[itemprop="image"]')
    .map((_, el) => $(el).attr('src') ?? $(el).attr('content') ?? $(el).attr('href'))
    .get()
    .filter(Boolean);
  const name = prop('name');
  if (!name) return null;
  return {
    '@source': 'microdata',
    name,
    description: prop('description'),
    image: images.length ? images : undefined,
    brand: prop('brand'),
    category: prop('category'),
    offers: { price: prop('price')?.replace(/[^\d.,]/g, ''), priceCurrency: prop('priceCurrency') },
  };
}

/** Flattens arrays and @graph containers into a list of JSON-LD nodes. */
function collect(node: unknown, out: Json[], depth = 0) {
  if (depth > 5 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => collect(n, out, depth + 1));
  const obj = node as Json;
  out.push(obj);
  if (obj['@graph']) collect(obj['@graph'], out, depth + 1);
  // ProductGroup variants often carry the images and offers.
  if (obj.hasVariant) collect(obj.hasVariant, out, depth + 1);
}

function toImageList(src: unknown): string[] {
  if (!src) return [];
  if (typeof src === 'string') return [src];
  if (Array.isArray(src)) return src.flatMap(toImageList);
  if (typeof src === 'object') {
    const o = src as Json;
    return toImageList(o.contentUrl ?? o.url);
  }
  return [];
}

function firstOf(v: unknown): Json | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Json;
  // AggregateOffer may nest the real offers.
  return o.offers && !o.price && !o.lowPrice ? firstOf(o.offers) : o;
}

function nameOf(v: unknown): unknown {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? (x as Json).name : x;
}

function asText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function clean(s: string | undefined | null): string | null {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? decodeEntities(t) : null;
}

function decodeEntities(s: string) {
  return cheerio.load(`<p>${s}</p>`)('p').text();
}

function stripHtml(s: string | undefined) {
  return s?.replace(/<[^>]+>/g, ' ');
}

/** "Classic Mug | Acme Store" → "Classic Mug". */
function cleanTitle(title: string | null): string | null {
  if (!title) return null;
  const parts = title.split(/\s+[|–—-]\s+/);
  const first = parts[0]?.trim();
  return first && first.length >= 3 ? truncate(first, 120) : truncate(title, 120);
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function absolutize(src: string, base: string): string | null {
  const s = src.trim();
  if (!s || s.startsWith('data:')) return null;
  try {
    const u = new URL(s.startsWith('//') ? `https:${s}` : s, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function largestFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const items = srcset
    .split(',')
    .map((part) => {
      const [url, size] = part.trim().split(/\s+/);
      return { url, w: parseInt(size ?? '0', 10) || 0 };
    })
    .filter((i): i is { url: string; w: number } => !!i.url);
  return items.sort((a, b) => b.w - a.w)[0]?.url;
}

function isLikelyPhoto(url: string) {
  const path = new URL(url).pathname.toLowerCase();
  return !/\.(svg|gif|ico)$/.test(path) && !/(logo|icon|sprite|placeholder|badge|payment)/.test(path);
}
