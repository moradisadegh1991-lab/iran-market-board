/**
 * قیمت‌یابی دیجی‌کالا برای لیست خرید (lib/digikala, rule 103): the search answer read in the shape the site's own API
 * gives (prices in rial — the book's unit), nothing priced at 0, only Digikala links and pictures, the estimate =
 * price × the count the quantity states, and the request goes from the device to Digikala only — with the item's
 * name and nothing else.
 * Run: npx tsx scripts/digikala-test.ts
 */
import assert from 'node:assert';
import { dkProduct, dkSearch } from '../lib/digikala/client';
import { parseProductPage, parseSearch, productLink, qtyCount, searchApiUrl, siteSearchLink } from '../lib/digikala/parse';
import { emptyData } from '../lib/finance/model';
import { addItem, linkProduct, listItems, listTotals, refreshProduct, unlinkProduct } from '../lib/finance/shopping';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};

// the search answer as the site's API gives it (fields the known clients read); prices in rial
const SEARCH = {
  status: 200,
  data: {
    products: [
      {
        id: 4413125,
        title_fa: 'شیر کم چرب پاستوریزه میهن - 1 لیتر',
        title_en: 'Mihan Low Fat Milk 1L',
        url: { uri: '/product/dkp-4413125/شیر-کم-چرب-میهن/' },
        status: 'marketable',
        images: { main: { url: ['https://dkstatics-public.digikala.com/digikala-products/abc.jpg?x-oss-process=image/resize'] } },
        default_variant: { id: 1, price: { selling_price: 452000, rrp_price: 520000, discount_percent: 13, is_incredible: false } },
      },
      // out of stock: the site sends default_variant as an empty list
      { id: 555, title_fa: 'شیر کامل ۲ لیتری', url: { uri: '/product/dkp-555/' }, status: 'out_of_stock', default_variant: [] },
      // a link and a picture that are not Digikala's: never used as given
      {
        id: 777,
        title_fa: 'شیر بادام',
        url: { uri: 'javascript:alert(1)' },
        status: 'marketable',
        images: { main: { url: ['http://evil.example/x.jpg'] } },
        default_variant: { price: { selling_price: '1,250,000', rrp_price: 1_250_000, discount_percent: 0 } },
      },
      // a «price» of a few rial is not a price
      { id: 888, title_fa: 'شیر نمونه', status: 'marketable', default_variant: { price: { selling_price: 10 } } },
      { id: 0, title_fa: 'بی‌شناسه' },
      { id: 999 },
    ],
    pager: { current_page: 1, total_pages: 12, total_items: 233 },
  },
};

(async () => {
  await ok('the search answer: rial prices as given, discount, out of stock unpriced, bad entries dropped', () => {
    const r = parseSearch(SEARCH)!;
    assert.equal(r.total, 233);
    assert.deepEqual(r.products.map((p) => p.id), [4413125, 555, 777, 888]);
    const [milk, out, almond, tiny] = r.products;
    assert.equal(milk.priceRial, 452_000, 'rial, as Digikala gives it: 45,200 toman on the site');
    assert.deepEqual([milk.rrpRial, milk.discountPct, milk.available], [520_000, 13, true]);
    assert.equal(milk.url, 'https://www.digikala.com/product/dkp-4413125/شیر-کم-چرب-میهن/');
    assert.match(milk.image!, /^https:\/\/dkstatics-public\.digikala\.com\//);
    assert.deepEqual([out.priceRial, out.available], [null, false], 'out of stock: no price, not 0');
    assert.equal(almond.priceRial, 1_250_000, 'a price written as text is read');
    assert.equal(almond.url, productLink(777), 'a non-Digikala link becomes the product page');
    assert.equal(almond.image, null, 'a picture from elsewhere is not shown');
    assert.deepEqual([almond.rrpRial, almond.discountPct], [null, 0]);
    assert.deepEqual([tiny.priceRial, tiny.available], [null, false]);
    assert.equal(parseSearch({ status: 403, message: 'nope' }), null);
    assert.equal(parseSearch('<html>challenge</html>'), null);
    // a product page (v2)
    const pg = parseProductPage({ status: 200, data: { product: SEARCH.data.products[0] } })!;
    assert.equal(pg.priceRial, 452_000);
  });

  await ok('the request: only the name, to Digikala; «cheapest» only among things in stock; the site link for browsers', () => {
    const u = new URL(searchApiUrl(' شیر کم چرب ', 'relevant'));
    assert.equal(u.origin, 'https://api.digikala.com');
    assert.equal(u.pathname, '/v1/search/');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['page', 'q', 'sort']);
    assert.equal(u.searchParams.get('q'), 'شیر کم چرب');
    const c = new URL(searchApiUrl('شیر', 'cheapest'));
    assert.deepEqual([c.searchParams.get('sort'), c.searchParams.get('has_selling_stock')], ['20', '1']);
    assert.equal(siteSearchLink('شیر و نان'), 'https://www.digikala.com/search/?q=%D8%B4%DB%8C%D8%B1%20%D9%88%20%D9%86%D8%A7%D9%86');
  });

  await ok('the count a quantity states: «۳ تا» ×3, «۲ کیلو» ×1, nonsense ×1', () => {
    assert.deepEqual(['۳', '۲ تا', '4 عدد', '۲ بسته', '۲ کیلو', 'یک بسته', '', undefined, '۰', '۵۰۰ گرم', '1000'].map(qtyCount), [3, 2, 4, 2, 1, 1, 1, 1, 1, 1, 1]);
  });

  await ok('«انتخاب»: the estimate is the price × count; unlinking drops only an estimate that came from Digikala', () => {
    const d = emptyData('2026-10-25');
    const a = addItem(d, { name: 'شیر', qty: '۳ تا' }) as { id: string };
    const b = addItem(d, { name: 'نان', estRial: 300_000 }) as { id: string };
    const milk = parseSearch(SEARCH)!.products[0];
    linkProduct(d, a.id, milk, 1);
    const it = listItems(d).find((x) => x.id === a.id)!;
    assert.equal(it.estRial, 3 * 452_000);
    assert.deepEqual([it.dk!.id, it.dk!.priceRial, it.dk!.url], [4413125, 452_000, milk.url]);
    // an unavailable product keeps the item's own estimate
    linkProduct(d, b.id, parseSearch(SEARCH)!.products[1], 1);
    assert.equal(listItems(d).find((x) => x.id === b.id)!.estRial, 300_000);
    const t = listTotals(d);
    assert.deepEqual([t.leftEstRial, t.leftDk, t.leftUnpriced], [3 * 452_000 + 300_000, 1, 0]);
    // a new price for the same product: the estimate follows
    refreshProduct(d, a.id, { ...milk, priceRial: 480_000 }, 2);
    assert.equal(listItems(d).find((x) => x.id === a.id)!.estRial, 3 * 480_000);
    // another product's answer is not applied
    refreshProduct(d, a.id, { ...milk, id: 1, priceRial: 1000 }, 3);
    assert.equal(listItems(d).find((x) => x.id === a.id)!.estRial, 3 * 480_000);
    unlinkProduct(d, a.id);
    assert.deepEqual([listItems(d).find((x) => x.id === a.id)!.dk, listItems(d).find((x) => x.id === a.id)!.estRial], [null, null]);
    unlinkProduct(d, b.id);
    assert.equal(listItems(d).find((x) => x.id === b.id)!.estRial, 300_000, 'the typed estimate stays');
  });

  await ok('the client: one GET to api.digikala.com; a challenge page or a refused browser is said, not shown as no results', async () => {
    const calls: string[] = [];
    let answer: () => Response = () => new Response(JSON.stringify(SEARCH), { status: 200 });
    globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(u)}`);
      return answer();
    }) as typeof fetch;
    const r = await dkSearch('شیر');
    assert.ok(r.ok && r.value!.products.length === 4);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^GET https:\/\/api\.digikala\.com\/v1\/search\/\?/);
    answer = () => new Response('<html><title>challenge</title></html>', { status: 200 });
    const ch = await dkSearch('شیر');
    assert.ok(!ch.ok && /بررسی ربات/.test(ch.error!), ch.error);
    answer = () => new Response('{}', { status: 429 });
    assert.match((await dkSearch('شیر')).error!, /زیاد/);
    answer = () => {
      throw new TypeError('Failed to fetch');
    };
    const br = await dkSearch('شیر');
    assert.ok(!br.ok && /جست‌وجو در سایت دیجی‌کالا/.test(br.error!));
    answer = () => new Response(JSON.stringify({ status: 200, data: { product: SEARCH.data.products[0] } }), { status: 200 });
    const p = await dkProduct(4413125);
    assert.equal(p.value?.priceRial, 452_000);
    assert.match(calls.at(-1)!, /^GET https:\/\/api\.digikala\.com\/v2\/product\/4413125\/$/);
    assert.equal(calls.length, 5, 'one request each, never repeated');
  });

  console.log(`\n${n} digikala checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
