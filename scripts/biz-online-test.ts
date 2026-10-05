/**
 * Pins «فروشگاه آنلاین» (rule 80): what is published holds nothing private, a slug belongs to the
 * token that claimed it, customers' prices come from the catalog, two customers cannot take the same
 * time, the phone applies each inbox item exactly once, and only then is it deleted on the server.
 * Runs on the in-memory store (no Redis env).
 * Run: npx tsx scripts/biz-online-test.ts
 */
import assert from 'node:assert';
import { emptyData } from '../lib/finance/model';
import { addBooking, addIngredient, addProduct, confirmOrder, setBomLine, setupBusiness } from '../lib/biz/ops';
import { applyInbox, newToken } from '../lib/biz/online';
import { catalogOf, checkOrder, cleanCatalog, mobile } from '../lib/biz/public';
import { getCatalog, publish, pull, refState, setRefStatus, submit, unpublish } from '../lib/biz/server';
import { tehranMs } from '../lib/biz/slots';
import type { Ingredient, Product } from '../lib/biz/model';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-05';
const NOW = tehranMs(TODAY, '08:00');
const T = 10;

function shop() {
  const d = emptyData(TODAY);
  setupBusiness(d, { name: 'سالن مینا', type: 'salon', card: 'new', now: NOW, today: TODAY });
  const b = d.biz!;
  const ing = addIngredient(b, { name: 'لاک', unit: 'عدد' }, NOW) as Ingredient;
  const p = addProduct(b, { name: 'لاک ناخن', priceRial: 200_000 * T }, NOW) as Product;
  setBomLine(b, p.id, ing.id, 1);
  b.services.push({ id: 'cut', name: 'کوتاهی مو', durationMin: 60, priceRial: 500_000 * T, active: true });
  const mine = addBooking(b, { serviceIds: ['cut'], customerName: 'رازی', customerPhone: '09129998877', startsAt: tehranMs(TODAY, '10:00'), source: 'manual', note: 'خصوصی' }, NOW);
  assert.ok(typeof mine !== 'string');
  b.online = { slug: 'salon-mina', token: newToken(), seen: [] };
  return { d, b, p };
}

(async () => {
  await ok('the catalog carries no customer, cost, stock or sale', () => {
    const { d, b } = shop();
    b.ingredients[0].unitCostRial = 77_777;
    const cat = catalogOf(b, 'salon-mina', NOW, TODAY);
    const json = JSON.stringify(cat);
    for (const secret of ['رازی', '09129998877', 'خصوصی', '77777', 'لاک"', 'stock', 'cost', 'customer']) assert.ok(!json.includes(secret), `leaks ${secret}`);
    assert.deepEqual(cat.busy, [{ startsAt: tehranMs(TODAY, '10:00'), durationMin: 60, seatId: null }]);
    assert.equal(cat.products[0].name, 'لاک ناخن');
    void d;
  });

  await ok('cleanCatalog bounds what the server stores', () => {
    const c = cleanCatalog({ name: 'x'.repeat(500), products: [{ id: 'p', name: 'a', priceRial: -5, imageUrl: 'javascript:alert(1)', extra: 'no' }], services: [{ id: 's', name: 'b', durationMin: 0 }], vatPct: 400 }, 'abc', NOW);
    assert.equal(c.name.length, 80);
    assert.deepEqual(c.products[0], { id: 'p', name: 'a', priceRial: 0, category: null, description: null, imageUrl: null });
    assert.equal(c.services[0].durationMin, 5);
    assert.equal(c.vatPct, 100);
    assert.throws(() => cleanCatalog({}, 'abc', NOW));
  });

  await ok('mobile numbers: Persian digits, +98, 9…', () => {
    assert.deepEqual(['۰۹۱۲۳۴۵۶۷۸۹', '+98 912 345 6789', '9123456789', '0212222222', 'x'].map(mobile), ['09123456789', '09123456789', '09123456789', null, null]);
  });

  const { d, b, p } = shop();
  const token = b.online!.token;
  await ok('a slug belongs to the token that claimed it', async () => {
    assert.equal((await publish('salon-mina', token, catalogOf(b, 'salon-mina', NOW, TODAY), NOW)).ok, true);
    const other = await publish('salon-mina', newToken(), catalogOf(b, 'salon-mina', NOW, TODAY), NOW);
    assert.ok(!other.ok && other.status === 409);
    assert.ok(!(await publish('Bad Slug', token, {}, NOW)).ok);
    assert.equal((await getCatalog('salon-mina'))!.name, 'سالن مینا');
    const steal = await pull('salon-mina', newToken(), []);
    assert.ok(!steal.ok && steal.status === 403);
  });

  let orderId = '';
  await ok('an order: prices from the catalog, never from the customer', async () => {
    const bad = await submit('salon-mina', 'order', { name: 'سارا', phone: '0912', items: [{ id: p.id, qty: 1 }] }, 'web', 'ip1', NOW);
    assert.ok(!bad.ok);
    const r = await submit('salon-mina', 'order', { name: 'سارا', phone: '۰۹۳۵۱۱۱۲۲۳۳', items: [{ id: p.id, qty: 2, priceRial: 1 }, { id: 'nope', qty: 3 }], note: 'زنگ بزنید' }, 'web', 'ip1', NOW);
    assert.ok(r.ok);
    assert.deepEqual([r.item.phone, r.item.totalRial, r.item.lines!.length], ['09351112233', 400_000 * T, 1]);
    orderId = r.id;
    const c = checkOrder((await getCatalog('salon-mina'))!, { name: 'a', phone: '09120000000', items: [] });
    assert.ok(!c.ok);
  });

  let bookingId = '';
  await ok('bookings: outside hours, a taken time and a time someone else just took are refused', async () => {
    const at = (t: string) => tehranMs(TODAY, t);
    assert.equal((await submit('salon-mina', 'booking', { name: 'الف', phone: '09120000001', serviceIds: ['cut'], startsAt: at('10:30') }, 'web', 'ip2', NOW) as { error: string }).error, 'این زمان همین الان پر شد؛ زمان دیگری انتخاب کنید.');
    assert.equal((await submit('salon-mina', 'booking', { name: 'الف', phone: '09120000001', serviceIds: ['cut'], startsAt: at('20:30') }, 'web', 'ip2', NOW) as { error: string }).error, 'این زمان در ساعت کاری نیست.');
    const first = await submit('salon-mina', 'booking', { name: 'ب', phone: '09120000002', serviceIds: ['cut'], startsAt: at('12:00') }, 'telegram', 'tg:1', NOW, 4242);
    assert.ok(first.ok);
    bookingId = first.id;
    const second = await submit('salon-mina', 'booking', { name: 'ج', phone: '09120000003', serviceIds: ['cut'], startsAt: at('12:30') }, 'web', 'ip3', NOW);
    assert.ok(!second.ok, 'the waiting booking holds its time');
  });

  await ok('rate limit per visitor', async () => {
    let last: { ok: boolean; status?: number } = { ok: true };
    for (let i = 0; i < 25; i++) last = await submit('salon-mina', 'order', { name: 'x', phone: '09120000009', items: [{ id: p.id, qty: 1 }] }, 'web', 'flood', NOW);
    assert.ok(!last.ok && last.status === 429);
  });

  await ok('the phone applies each item once; acknowledged items leave the server', async () => {
    const r = await pull('salon-mina', token, []);
    assert.ok(r.ok);
    const items = r.items.filter((x) => x.id === orderId || x.id === bookingId);
    assert.equal(items.length, 2);
    const a = applyInbox(d, items, NOW + 1000);
    assert.deepEqual([a.orders, a.bookings], [1, 1]);
    const again = applyInbox(d, items, NOW + 2000);
    assert.deepEqual([again.orders, again.bookings, again.ack.length], [0, 0, 2], 'a repeated pull books nothing twice');
    const o = b.orders.find((x) => x.ref === orderId)!;
    assert.deepEqual([o.status, o.channel, o.totalRial, o.customerPhone], ['pending', 'web', 400_000 * T, '09351112233']);
    const bk = b.bookings.find((x) => x.ref === bookingId)!;
    assert.deepEqual([bk.status, bk.source, bk.serviceNames], ['pending', 'telegram', ['کوتاهی مو']]);
    // confirming it is an ordinary sale
    assert.equal(confirmOrder(d, o.id, 'cash', NOW + 3000), null);
    assert.equal(b.ingredients[0].stock, -2);
    const after = await pull('salon-mina', token, a.ack);
    assert.ok(after.ok && !after.items.some((x) => x.id === orderId || x.id === bookingId));
  });

  await ok('statuses reach the customer; only the owner can set them', async () => {
    assert.ok(!(await setRefStatus('salon-mina', newToken(), bookingId, 'confirmed')).ok);
    const r = await setRefStatus('salon-mina', token, bookingId, 'confirmed');
    assert.ok(r.ok && r.chat === 4242);
    assert.equal((await refState('salon-mina', bookingId))!.status, 'confirmed');
  });

  await ok('a time taken on the phone after publishing still reaches the owner, flagged', async () => {
    const r = await submit('salon-mina', 'booking', { name: 'د', phone: '09120000004', serviceIds: ['cut'], startsAt: tehranMs(TODAY, '15:00') }, 'web', 'ip4', NOW);
    assert.ok(r.ok);
    addBooking(b, { serviceIds: ['cut'], customerPhone: '09120000005', startsAt: tehranMs(TODAY, '15:00'), source: 'manual' }, NOW);
    applyInbox(d, [r.item], NOW);
    const bk = b.bookings.find((x) => x.ref === r.id)!;
    assert.ok(bk.note!.startsWith('⚠️'));
  });

  await ok('unpublish removes everything', async () => {
    assert.ok((await unpublish('salon-mina', token)).ok);
    assert.equal(await getCatalog('salon-mina'), null);
    assert.ok(!(await submit('salon-mina', 'order', { name: 'x', phone: '09120000000', items: [{ id: p.id, qty: 1 }] }, 'web', 'ip9', NOW)).ok);
  });

  console.log(`\n${n} online checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
