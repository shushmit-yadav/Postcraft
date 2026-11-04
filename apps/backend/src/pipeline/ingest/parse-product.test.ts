import { describe, expect, it } from 'vitest';
import { parseProductPage } from './parse-product.js';

const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const URL_ = 'https://shop.example.com/products/sunrise-mug';

describe('parseProductPage', () => {
  it('reads schema.org Product JSON-LD, including @graph and AggregateOffer', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Acme' },
        {
          '@type': 'Product',
          name: 'Sunrise Mug &amp; Saucer',
          description: '<p>Keeps coffee hot for hours.</p>',
          brand: { '@type': 'Brand', name: 'Acme Home' },
          image: ['/img/mug-1.jpg', { '@type': 'ImageObject', url: 'https://cdn.example.com/mug-2.jpg' }],
          offers: { '@type': 'AggregateOffer', lowPrice: '24.00', priceCurrency: 'USD' },
        },
      ],
    };
    const p = parseProductPage(
      page(`<script type="application/ld+json">${JSON.stringify(ld)}</script><meta property="og:title" content="Acme | Home">`),
      URL_,
    );
    expect(p.source).toBe('json-ld');
    expect(p.title).toBe('Sunrise Mug & Saucer');
    expect(p.description).toBe('Keeps coffee hot for hours.');
    expect(p.brand).toBe('Acme Home');
    expect(p.price).toBe('24.00');
    expect(p.currency).toBe('USD');
    expect(p.imageUrls).toEqual(['https://shop.example.com/img/mug-1.jpg', 'https://cdn.example.com/mug-2.jpg']);
  });

  it('ignores malformed JSON-LD blocks and falls back to microdata', () => {
    const p = parseProductPage(
      page(
        '<script type="application/ld+json">{ not json</script><meta property="og:title" content="Site-wide title">',
        `<div itemscope itemtype="https://schema.org/Product">
           <h1 itemprop="name">Trail Runner 2</h1>
           <img itemprop="image" src="/shoe.jpg">
           <span itemprop="price" content="119.95">$119.95</span><meta itemprop="priceCurrency" content="EUR">
         </div>`,
      ),
      URL_,
    );
    expect(p.source).toBe('microdata');
    expect(p.title).toBe('Trail Runner 2');
    expect(p.price).toBe('119.95');
    expect(p.currency).toBe('EUR');
    expect(p.imageUrls[0]).toBe('https://shop.example.com/shoe.jpg');
  });

  it('falls back to OpenGraph and cleans the store name out of the title', () => {
    const p = parseProductPage(
      page(`<meta property="og:title" content="Linen Shirt – Coastal Co">
            <meta property="og:description" content="Breathable linen.">
            <meta property="og:image" content="//cdn.example.com/shirt.jpg">
            <meta property="product:price:amount" content="59"><meta property="product:price:currency" content="GBP">`),
      URL_,
    );
    expect(p.source).toBe('opengraph');
    expect(p.title).toBe('Linen Shirt');
    expect(p.imageUrls).toEqual(['https://cdn.example.com/shirt.jpg']);
    expect(p.price).toBe('59');
  });

  it('uses gallery images from plain HTML, product-looking ones first, and skips logos and svg', () => {
    const p = parseProductPage(
      page(
        '<title>A Light in the Attic | Books</title>',
        `<img src="/logo.png"><img src="/icons/cart.svg">
         <div id="product_gallery"><div class="item"><img src="../../media/cover.jpg"></div></div>
         <img src="/other.jpg">`,
      ),
      'https://books.example.com/catalogue/a-light/index.html',
    );
    expect(p.title).toBe('A Light in the Attic');
    expect(p.imageUrls[0]).toBe('https://books.example.com/media/cover.jpg');
    expect(p.imageUrls).not.toContain('https://books.example.com/logo.png');
    expect(p.imageUrls.some((u) => u.endsWith('.svg'))).toBe(false);
  });

  it('drops data: URIs and non-http image sources', () => {
    const p = parseProductPage(
      page('<meta property="og:title" content="X Product"><meta property="og:image" content="data:image/png;base64,AAAA"><meta name="twitter:image" content="javascript:alert(1)">'),
      URL_,
    );
    expect(p.imageUrls).toEqual([]);
  });
});
