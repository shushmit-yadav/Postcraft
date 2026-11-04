/** "29.5" + "USD" → "$29.50". Falls back gracefully for unknown currencies or non-numeric prices. */
export function formatPrice(price?: string | null, currency?: string | null): string | null {
  if (!price) return null;
  const amount = Number(price.replace(/,/g, ''));
  if (currency && Number.isFinite(amount)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch {
      /* unknown currency code */
    }
  }
  return currency ? `${price} ${currency}` : price;
}
