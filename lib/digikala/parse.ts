// دیجی‌کالا — the pure half of «قیمت‌یابی» for the shopping list (rule 103).
//
// Digikala's Seller Open API (seller.digikala.com/open-api) manages a seller's own store with a seller's token; it
// cannot look up what things cost. What the website itself uses can: the public search
// (GET api.digikala.com/v1/search/?q=…) and a product (GET api.digikala.com/v2/product/<id>/). Neither is
// documented by Digikala, so this parser accepts what the known clients read and nothing it cannot check:
//   {status: 200, data: {products: [{id, title_fa, url: {uri}, status, images: {main: {url: [..]}},
//     default_variant: {price: {selling_price, rrp_price, discount_percent}}}], pager: {total_items}}}
// Prices there are in RIAL (the site shows toman = ÷10) — the book's own unit, so nothing is converted (rule 1).
// A product without a selling price (out of stock: default_variant is []) is listed as unavailable, never priced at 0.

export const DK_API = 'https://api.digikala.com';
export const DK_SITE = 'https://www.digikala.com';

export interface DkProduct {
  id: number;
  title: string;
  /** what it sells for now, rial; null = not for sale now */
  priceRial: number | null;
  /** the price before the discount, rial, when there is one */
  rrpRial: number | null;
  discountPct: number;
  available: boolean;
  /** always a www.digikala.com product page */
  url: string;
  /** a Digikala-hosted picture, or null */
  image: string | null;
}

export type DkSort = 'relevant' | 'cheapest';
/** the site's own sort codes */
const SORT: Record<DkSort, number> = { relevant: 22, cheapest: 20 };

export function searchApiUrl(q: string, sort: DkSort = 'relevant', page = 1): string {
  const p = new URLSearchParams({ q: q.trim(), page: String(page), sort: String(SORT[sort]) });
  // the cheapest of things that cannot be bought is no estimate
  if (sort === 'cheapest') p.set('has_selling_stock', '1');
  return `${DK_API}/v1/search/?${p.toString()}`;
}
export const productApiUrl = (id: number) => `${DK_API}/v2/product/${Math.trunc(id)}/`;
/** the site's search page: works in any browser, no API needed */
export const siteSearchLink = (q: string) => `${DK_SITE}/search/?q=${encodeURIComponent(q.trim())}`;
export const productLink = (id: number) => `${DK_SITE}/product/dkp-${Math.trunc(id)}/`;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[,٬]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** a picture only from Digikala's own hosts, only https */
function safeImage(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)digikala\.com$|(^|\.)dkstatics-public\.digikala\.com$/.test(x.hostname) ? x.toString() : null;
  } catch {
    return null;
  }
}

/** the product page: the API's own path when it is a /product/ path, else built from the id — never a foreign link */
function safeUrl(uri: unknown, id: number): string {
  if (typeof uri === 'string' && /^\/product\/dkp-\d+\/[^\s"'<>]*$/.test(uri)) return `${DK_SITE}${uri}`;
  return productLink(id);
}

export function parseProduct(raw: unknown): DkProduct | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = num(p.id);
  if (!id || id <= 0) return null;
  const title = (typeof p.title_fa === 'string' && p.title_fa.trim()) || (typeof p.title_en === 'string' && p.title_en.trim()) || '';
  if (!title) return null;
  const dv = p.default_variant && typeof p.default_variant === 'object' && !Array.isArray(p.default_variant) ? (p.default_variant as Record<string, unknown>) : null;
  const price = dv?.price && typeof dv.price === 'object' ? (dv.price as Record<string, unknown>) : null;
  const sell = num(price?.selling_price);
  // a few hundred rial is not a price on Digikala: treat as missing rather than a 99% bargain
  const priceRial = sell && sell >= 1000 ? Math.round(sell) : null;
  const rrp = num(price?.rrp_price);
  const rrpRial = rrp && priceRial && rrp > priceRial ? Math.round(rrp) : null;
  const disc = num(price?.discount_percent);
  const status = typeof p.status === 'string' ? p.status : '';
  const imgs = (p.images as { main?: { url?: unknown[]; webp_url?: unknown[] } } | undefined)?.main;
  return {
    id,
    title: title.replace(/\s+/g, ' '),
    priceRial,
    rrpRial,
    discountPct: disc && disc > 0 && disc < 100 && rrpRial ? Math.round(disc) : 0,
    available: !!priceRial && (status === '' || status === 'marketable'),
    url: safeUrl((p.url as { uri?: unknown } | undefined)?.uri, id),
    image: safeImage(imgs?.url?.[0]) ?? safeImage(imgs?.webp_url?.[0]),
  };
}

const dataOf = (json: unknown): Record<string, unknown> | null => {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  return o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : o;
};

/** the search answer: its products (unreadable ones dropped) and how many the site found; null = not a search answer */
export function parseSearch(json: unknown): { products: DkProduct[]; total: number | null } | null {
  const d = dataOf(json);
  if (!d || !Array.isArray(d.products)) return null;
  const products = d.products.map(parseProduct).filter((x): x is DkProduct => !!x);
  const total = num((d.pager as { total_items?: unknown } | undefined)?.total_items);
  return { products, total };
}

/** one product's page (v2): {data: {product: {...}}} */
export function parseProductPage(json: unknown): DkProduct | null {
  const d = dataOf(json);
  return d ? parseProduct(d.product ?? null) : null;
}

/** how many of the thing a shopping-list quantity asks for, when it says a plain count («۳»، «۲ تا»، «۴ عدد»); else 1 */
export function qtyCount(qty: string | undefined): number {
  if (!qty) return 1;
  const s = qty.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).trim();
  const m = /^(\d{1,3})\s*(تا|عدد|دونه|دانه|بسته|بطری|قوطی)?$/.exec(s);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 99 ? n : 1;
}
