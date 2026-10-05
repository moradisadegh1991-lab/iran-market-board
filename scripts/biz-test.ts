/**
 * Pins کسب‌وکار من (lib/biz, ported from Kasbai): the sale (Kasbai's on_order_confirmed trigger),
 * stock and moving-average cost, the customer club, the credit book, bookings without overlap, the
 * daily «فروش روز» row in the personal book, and that the business's own money is not personal
 * income or spending (rule 80).
 * Run: npx tsx scripts/biz-test.ts
 */
import assert from 'node:assert';
import { accountBalances, monthOf, monthTotals, netWorth } from '../lib/finance/calc';
import { deleteTxn } from '../lib/finance/actions';
import { emptyData, normalizeData, type FinanceData } from '../lib/finance/model';
import {
  addBooking,
  addCreditPayment,
  addExpense,
  addIngredient,
  addProduct,
  addPurchase,
  applyTemplate,
  cancelOrder,
  compactBiz,
  confirmOrder,
  createOrder,
  creditBalance,
  editIngredient,
  importProducts,
  inSegment,
  ownerDraw,
  productCost,
  quickSale,
  rebookDay,
  removeProduct,
  rescheduleBooking,
  setBomLine,
  setBookingStatus,
  setupBusiness,
} from '../lib/biz/ops';
import { analyze, dailyProfit, priceChecks, stockOutlook, sumRows, taxEstimate } from '../lib/biz/reports';
import { availableSlots, fits, tehranMs, tehranParts, windowsFor } from '../lib/biz/slots';
import { templatesFor } from '../lib/biz/templates';
import type { Ingredient, Product } from '../lib/biz/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-05'; // ۱۳ مهر ۱۴۰۵، دوشنبه
const T = 10; // one toman in rial
const at = (time: string, date = TODAY) => tehranMs(date, time);

function shop(): { d: FinanceData; burger: Product; bread: Ingredient; meat: Ingredient } {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'me', name: 'حساب شخصی', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' });
  assert.equal(setupBusiness(d, { name: 'برگر رضا', type: 'fastfood', card: 'new', now: at('08:00'), today: TODAY }), null);
  const b = d.biz!;
  b.hourlyRial = 600_000 * T; // 600k toman an hour → 10k toman a minute
  const bread = addIngredient(b, { name: 'نان', unit: 'عدد', reorder: 5 }, at('08:00')) as Ingredient;
  const meat = addIngredient(b, { name: 'گوشت', unit: 'kg', reorder: 1 }, at('08:00')) as Ingredient;
  assert.equal(addPurchase(d, { ingredientId: bread.id, qty: 20, unitCostRial: 10_000 * T, accountId: b.cashAccountId, date: TODAY }, at('08:10')), null);
  assert.equal(addPurchase(d, { ingredientId: meat.id, qty: 4, unitCostRial: 800_000 * T, date: TODAY }, at('08:10')), null);
  const burger = addProduct(b, { name: 'همبرگر', priceRial: 250_000 * T, category: 'برگر', prepMin: 3 }, at('08:20')) as Product;
  setBomLine(b, burger.id, bread.id, 1);
  setBomLine(b, burger.id, meat.id, 0.15);
  return { d, burger, bread, meat };
}

ok('setup: the till and the card are accounts of the book, marked as the business’s', () => {
  const { d } = shop();
  const b = d.biz!;
  const till = d.accounts.find((a) => a.id === b.cashAccountId)!;
  const card = d.accounts.find((a) => a.id === b.cardAccountId)!;
  assert.deepEqual([till.kind, till.bizId, card.kind, card.bizId], ['cash', b.id, 'bank', b.id]);
  assert.ok(['i-biz', 'c-biz', 'c-bizbuy', 'i-bizdraw', 'c-bizcap'].every((id) => d.categories.some((c) => c.id === id)));
  assert.equal(setupBusiness(d, { name: 'دوم', type: 'cafe', card: 'none', now: 0, today: TODAY }), 'کسب‌وکار از قبل تعریف شده.');
});

ok('cost: recipe at moving-average price + labour (Kasbai’s product_costs)', () => {
  const { d, burger, meat } = shop();
  const b = d.biz!;
  // 10k bread + 0.15 × 800k meat + 3 min × 10k = 10k + 120k + 30k = 160k toman
  const c = productCost(b, burger);
  assert.deepEqual([c.materialRial, c.laborRial, c.unitRial, c.marginRial], [130_000 * T, 30_000 * T, 160_000 * T, 90_000 * T]);
  assert.equal(Math.round(c.marginPct!), 36);
  // a second meat purchase at 1,000k: (4 × 800 + 4 × 1000) / 8 = 900k
  addPurchase(d, { ingredientId: meat.id, qty: 4, unitCostRial: 1_000_000 * T, date: TODAY }, at('09:00'));
  assert.equal(b.ingredients.find((i) => i.id === meat.id)!.unitCostRial, 900_000 * T);
  assert.equal(b.ingredients.find((i) => i.id === meat.id)!.stock, 8);
});

ok('a cash sale: cost frozen, stock out by the recipe, «فروش روز» in the till, customer and points', () => {
  const { d, burger, bread, meat } = shop();
  const b = d.biz!;
  const o = quickSale(d, { items: [{ itemId: burger.id, qty: 2 }], channel: 'walkin', customerName: 'سارا', customerPhone: '۰۹۱۲۱۲۳۴۵۶۷', pay: 'cash', at: at('12:30'), deliver: true });
  assert.ok(typeof o !== 'string');
  assert.deepEqual([o.no, o.status, o.totalRial, o.costRial, o.saleDate, o.saleTime], [1, 'delivered', 500_000 * T, 320_000 * T, TODAY, '12:30']);
  assert.equal(b.ingredients.find((i) => i.id === bread.id)!.stock, 18);
  assert.equal(+b.ingredients.find((i) => i.id === meat.id)!.stock.toFixed(3), 3.7);
  const day = d.txns.filter((t) => t.link?.type === 'biz' && t.link.mk === `sales:${TODAY}`);
  assert.equal(day.length, 1);
  assert.deepEqual([day[0].kind, day[0].accountId, day[0].amountRial, day[0].time, day[0].categoryId], ['income', b.cashAccountId, 500_000 * T, '12:30', 'i-biz']);
  const c = b.customers[0];
  assert.deepEqual([c.phone, c.name, c.orders, c.spentRial, c.points], ['09121234567', 'سارا', 1, 500_000 * T, 50]);
  // a second cash sale the same day resizes the same row; a card sale gets its own
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'cash', at: at('13:00') });
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'card', at: at('13:05') });
  const rows = d.txns.filter((t) => t.link?.mk === `sales:${TODAY}`);
  assert.deepEqual(rows.map((t) => [t.accountId, t.amountRial, t.time]).sort(), [[b.cardAccountId, 250_000 * T, '13:05'], [b.cashAccountId, 750_000 * T, '13:00']].sort());
});

ok('discount and VAT: subtotal − discount + VAT on what is left; revenue excludes VAT', () => {
  const { d, burger } = shop();
  const b = d.biz!;
  b.vatPct = 10;
  b.discounts.push({ id: 'off', title: 'افتتاحیه', pct: 20, from: TODAY, to: TODAY, active: true });
  const o = quickSale(d, { items: [{ itemId: burger.id, qty: 4 }], channel: 'walkin', discountId: 'off', pay: 'card', at: at('18:00') });
  assert.ok(typeof o !== 'string');
  // 1,000k − 200k = 800k + 80k VAT = 880k
  assert.deepEqual([o.subtotalRial, o.discountRial, o.vatRial, o.totalRial], [1_000_000 * T, 200_000 * T, 80_000 * T, 880_000 * T]);
  const day = dailyProfit(b, TODAY, TODAY)[0];
  assert.deepEqual([day.revenueRial, day.costRial, day.vatRial], [800_000 * T, 640_000 * T, 80_000 * T]);
  // an expired discount is not applied
  const late = createOrder(b, { items: [{ itemId: burger.id, qty: 1 }], channel: 'phone', discountId: 'off', at: at('10:00', '2026-10-06') });
  assert.ok(typeof late !== 'string' && late.discountRial === 0);
});

ok('cancel undoes the sale exactly: stock back, customer, money', () => {
  const { d, burger, bread } = shop();
  const b = d.biz!;
  const o = quickSale(d, { items: [{ itemId: burger.id, qty: 3 }], channel: 'walkin', customerPhone: '09120000000', pay: 'cash', at: at('11:00') });
  assert.ok(typeof o !== 'string');
  assert.equal(cancelOrder(d, o.id, at('11:30')), null);
  assert.equal(b.ingredients.find((i) => i.id === bread.id)!.stock, 20);
  assert.deepEqual([b.customers[0].orders, b.customers[0].spentRial, b.customers[0].points], [0, 0, 0]);
  assert.equal(d.txns.filter((t) => t.link?.mk === `sales:${TODAY}`).length, 0);
  assert.equal(sumRows(dailyProfit(b, TODAY, TODAY)).revenueRial, 0);
});

ok('pending orders move nothing until confirmed; confirmation uses the payment method', () => {
  const { d, burger, bread } = shop();
  const b = d.biz!;
  const o = createOrder(b, { items: [{ itemId: burger.id, qty: 1 }], channel: 'web', customerName: 'علی', customerPhone: '09351112233', at: at('10:00') });
  assert.ok(typeof o !== 'string');
  assert.equal(b.ingredients.find((i) => i.id === bread.id)!.stock, 20);
  assert.equal(b.customers.length, 0);
  assert.equal(confirmOrder(d, o.id, 'card', at('10:05')), null);
  assert.equal(confirmOrder(d, o.id, 'card', at('10:06')), 'این سفارش قبلاً تأیید یا لغو شده.');
  assert.equal(d.txns.find((t) => t.link?.mk === `sales:${TODAY}`)!.accountId, b.cardAccountId);
});

ok('credit (نسیه): a credit sale moves no money; a payment into the till does', () => {
  const { d, burger } = shop();
  const b = d.biz!;
  const o = quickSale(d, { items: [{ itemId: burger.id, qty: 2 }], channel: 'walkin', customerName: 'حسن‌آقا', pay: 'credit', at: at('09:00') });
  assert.ok(typeof o !== 'string');
  const c = b.credit.find((x) => x.name === 'حسن‌آقا')!;
  assert.equal(creditBalance(c), 500_000 * T);
  assert.equal(d.txns.filter((t) => t.link?.mk === `sales:${TODAY}`).length, 0, 'no money yet');
  assert.equal(addCreditPayment(d, c.id, 200_000 * T, b.cashAccountId, null, at('17:00')), null);
  assert.equal(creditBalance(c), 300_000 * T);
  const pay = d.txns.find((t) => t.note === 'وصول نسیه حسن‌آقا')!;
  assert.deepEqual([pay.kind, pay.amountRial, pay.accountId], ['income', 200_000 * T, b.cashAccountId]);
  // the profit counts the credit sale on its day; cancelling it removes the debt
  assert.equal(sumRows(dailyProfit(b, TODAY, TODAY)).revenueRial, 500_000 * T);
  cancelOrder(d, o.id, at('18:00'));
  assert.equal(creditBalance(c), -200_000 * T, 'what was paid is now owed back to them');
  // deleting the payment row from the transactions list takes it off the credit book too
  deleteTxn(d, pay.id);
  assert.equal(c.entries.length, 0);
});

ok('the business is not personal income/spending; the owner’s draw is', () => {
  const { d, burger } = shop();
  const b = d.biz!;
  quickSale(d, { items: [{ itemId: burger.id, qty: 4 }], channel: 'walkin', pay: 'cash', at: at('12:00') });
  addExpense(d, { category: 'rent', amountRial: 300_000 * T, date: TODAY, accountId: b.cashAccountId });
  d.txns.push({ id: 'p1', date: TODAY, kind: 'expense', amountRial: 50_000 * T, accountId: 'me', categoryId: 'c-food' });
  assert.equal(ownerDraw(d, b.cashAccountId!, 'me', 400_000 * T, TODAY), null);
  assert.equal(ownerDraw(d, 'me', b.cashAccountId!, 1, TODAY), 'حساب مبدأ باید حساب کسب‌وکار باشد.');
  const m = monthTotals(d, monthOf(TODAY));
  assert.deepEqual([m.incomeRial, m.expenseRial], [400_000 * T, 50_000 * T]);
  assert.equal(m.byCategory.find((c) => c.categoryId === 'c-food')!.rial, 50_000 * T);
  // the till: −200k purchase of bread + 1,000k sales − 300k rent − 400k draw = 100k toman; net worth counts it
  const bal = accountBalances(d);
  assert.equal(bal[b.cashAccountId!], 100_000 * T);
  assert.equal(bal.me, 350_000 * T);
  assert.equal(netWorth(d, [], TODAY).cashRial, 450_000 * T);
  // the business’s own profit: 1,000k − 640k cost − 300k rent = 60k
  assert.equal(sumRows(dailyProfit(b, TODAY, TODAY)).profitRial, 60_000 * T);
});

ok('removing the day’s sales row from the book is respected until booked again', () => {
  const { d, burger } = shop();
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'cash', at: at('12:00') });
  const row = d.txns.find((t) => t.link?.mk === `sales:${TODAY}`)!;
  deleteTxn(d, row.id);
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'cash', at: at('13:00') });
  assert.equal(d.txns.filter((t) => t.link?.mk === `sales:${TODAY}`).length, 0);
  rebookDay(d, TODAY);
  assert.equal(d.txns.find((t) => t.link?.mk === `sales:${TODAY}`)!.amountRial, 500_000 * T);
});

ok('stock: counted stock is an adjustment; outlook and low stock from 30 days of use', () => {
  const { d, burger, bread } = shop();
  const b = d.biz!;
  assert.equal(editIngredient(b, bread.id, { stock: 12 }, at('08:30')), null);
  assert.equal(b.invTx.filter((t) => t.type === 'adjustment')[0].qty, -8);
  for (let i = 0; i < 3; i++) quickSale(d, { items: [{ itemId: burger.id, qty: 2 }], channel: 'walkin', pay: 'cash', at: at('12:00') });
  const o = stockOutlook(b, TODAY).find((x) => x.ingredient.id === bread.id)!;
  assert.equal(o.ingredient.stock, 6);
  assert.equal(+o.perDay.toFixed(2), 0.2); // 6 used / 30 days
  assert.equal(o.daysLeft, 30);
  assert.equal(o.low, false);
});

ok('a product once sold is archived, not deleted; templates make the product and its ingredients', () => {
  const { d, burger } = shop();
  const b = d.biz!;
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'cash', at: at('12:00') });
  assert.equal(removeProduct(b, burger.id), 'archived');
  assert.equal(b.products.find((p) => p.id === burger.id)!.active, false);
  const tpl = templatesFor('fastfood').find((t) => t.key === 'burger')!;
  const before = b.ingredients.length;
  const p = applyTemplate(b, tpl, at('14:00'));
  assert.equal(p.priceRial, tpl.suggestedPrice * T, 'templates are in toman');
  assert.equal(p.bom.length, tpl.ingredients.length);
  assert.ok(b.ingredients.length > before);
  const r = importProducts(b, [{ 'نام': 'اسپرسو', 'دسته': 'نوشیدنی', 'قیمت فروش': '45,000', 'زمان آماده‌سازی (دقیقه)': 3 }, { 'نام': 'اسپرسو', 'قیمت فروش': 50000 }, { 'نام': '' }, { 'نام': 'بد', 'قیمت فروش': 'x' }], at('14:00'));
  assert.deepEqual(r, { created: 1, updated: 1, failed: 1, skipped: 1 });
  assert.equal(b.products.find((x) => x.name === 'اسپرسو')!.priceRial, 50_000 * T);
});

ok('bookings: no overlap on one chair; seats share capacity; hours and shifts decide the times', () => {
  const d = emptyData(TODAY);
  setupBusiness(d, { name: 'آرایشگاه', type: 'barber', card: 'none', now: 0, today: TODAY });
  const b = d.biz!;
  b.services.push({ id: 'cut', name: 'اصلاح مو', durationMin: 30, priceRial: 300_000 * T, active: true }, { id: 'beard', name: 'اصلاح ریش', durationMin: 15, priceRial: 100_000 * T, active: true });
  const now = at('08:00');
  const one = addBooking(b, { serviceIds: ['cut', 'beard'], customerPhone: '09120000001', startsAt: at('10:00'), source: 'manual' }, now);
  assert.ok(typeof one !== 'string' && one.durationMin === 45 && one.priceRial === 400_000 * T);
  assert.equal(addBooking(b, { serviceIds: ['cut'], customerPhone: '09120000002', startsAt: at('10:30'), source: 'manual' }, now), 'این زمان با نوبت دیگری تداخل دارد.');
  const slots = availableSlots({ hours: b.hours, shifts: b.shifts, seatIds: [], busy: b.bookings }, TODAY, 30, now).map((t) => tehranParts(t).time);
  assert.ok(slots.includes('09:30') && !slots.includes('09:45') && !slots.includes('10:30') && slots.includes('10:45'));
  assert.equal(slots[0], '09:00');
  assert.equal(slots[slots.length - 1], '20:30');
  // Friday is closed by default
  assert.deepEqual(windowsFor(b, '2026-10-09'), []);
  // two chairs: a second booking at 10:00 fits on the other chair, a third does not
  b.seats.push({ id: 's1', name: 'صندلی ۱', capacity: 1, active: true }, { id: 's2', name: 'صندلی ۲', capacity: 1, active: true });
  one.seatId = 's1';
  const two = addBooking(b, { serviceIds: ['cut'], customerPhone: '09120000003', startsAt: at('10:00'), source: 'manual' }, now);
  assert.ok(typeof two !== 'string' && two.seatId === 's2');
  assert.equal(addBooking(b, { serviceIds: ['cut'], customerPhone: '09120000004', startsAt: at('10:15'), source: 'manual' }, now), 'این زمان با نوبت دیگری تداخل دارد.');
  // a shift for chair 2 only in the afternoon
  b.shifts.push({ id: 'sh', seatId: 's2', weekday: 1, from: '14:00', to: '18:00', active: true });
  assert.deepEqual(windowsFor(b, TODAY, 's2'), [{ from: '14:00', to: '18:00' }]);
  assert.deepEqual(windowsFor(b, TODAY, 's1'), [{ from: '09:00', to: '21:00' }]);
  // moving: refused within 2 hours, refused onto a full time, fine otherwise
  assert.equal(rescheduleBooking(b, one.id, at('15:00'), at('09:00')), 'کمتر از دو ساعت به این نوبت مانده؛ مستقیم با مشتری هماهنگ کنید.');
  assert.equal(rescheduleBooking(b, one.id, at('15:00'), now), null);
  assert.equal(one.originalStartsAt, at('10:00'));
  assert.ok(fits({ hours: b.hours, shifts: b.shifts, seatIds: ['s1', 's2'], busy: b.bookings }, at('10:30'), 30, 's1'));
});

ok('«انجام شد» is a sale of the services (a salon’s revenue), undone by reopening', () => {
  const d = emptyData(TODAY);
  setupBusiness(d, { name: 'سالن', type: 'salon', card: 'new', now: 0, today: TODAY });
  const b = d.biz!;
  b.services.push({ id: 'nail', name: 'کاشت ناخن', durationMin: 60, priceRial: 900_000 * T, active: true });
  const bk = addBooking(b, { serviceIds: ['nail'], customerName: 'مینا', customerPhone: '09120000009', startsAt: at('11:00'), source: 'manual' }, at('08:00'));
  assert.ok(typeof bk !== 'string');
  assert.equal(setBookingStatus(d, bk.id, 'done', at('12:00')), 'روش پرداخت را انتخاب کنید.');
  assert.equal(setBookingStatus(d, bk.id, 'done', at('12:00'), 'card'), null);
  const o = b.orders.find((x) => x.id === bk.orderId)!;
  assert.deepEqual([o.channel, o.status, o.totalRial, o.lines[0].kind, o.lines[0].name], ['booking', 'delivered', 900_000 * T, 'service', 'کاشت ناخن']);
  assert.equal(d.txns.find((t) => t.link?.mk === `sales:${TODAY}`)!.accountId, b.cardAccountId);
  assert.equal(b.customers[0].name, 'مینا');
  assert.equal(setBookingStatus(d, bk.id, 'confirmed', at('12:10')), null);
  assert.equal(b.orders.find((x) => x.id === o.id)!.status, 'canceled');
  assert.equal(d.txns.filter((t) => t.link?.mk === `sales:${TODAY}`).length, 0);
});

ok('analyst, price checks and segments', () => {
  const { d, burger } = shop();
  const b = d.biz!;
  const cheap = addProduct(b, { name: 'ساندویچ ارزان', priceRial: 100_000 * T, prepMin: 0 }, at('08:00', '2026-09-01')) as Product;
  setBomLine(b, cheap.id, d.biz!.ingredients[1].id, 0.15); // 120k of meat in a 100k sandwich
  addProduct(b, { name: 'نوشابه', priceRial: 40_000 * T }, at('08:00', '2026-09-01'));
  quickSale(d, { items: [{ itemId: burger.id, qty: 3 }], channel: 'walkin', pay: 'cash', at: at('13:10') });
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }, { itemId: cheap.id, qty: 1 }], channel: 'phone', pay: 'card', at: at('20:00', '2026-10-03') });
  const a = analyze(b, TODAY);
  assert.deepEqual([a.orders, a.revenueRial, a.peakHour, a.peakWeekday], [2, 1_100_000 * T, 13, 1]);
  assert.deepEqual(a.weeks, [0, 0, 0, 1_100_000 * T]);
  assert.equal(a.top[0].name, 'همبرگر');
  assert.deepEqual(a.unsold.map((x) => x.name), ['نوشابه']);
  assert.deepEqual(a.byChannel.map((x) => x.channel), ['walkin', 'phone']);
  const pc = priceChecks(b);
  assert.deepEqual(pc.map((x) => x.product.name), ['ساندویچ ارزان']);
  assert.equal(pc[0].suggestedRial, 172_000 * T, '120k ÷ 0.7 = 171.4k → 172k toman (up to 1,000 toman)');
  const c = { id: 'x', phone: '1', firstAt: 0, lastAt: at('08:00', '2026-08-01'), orders: 5, spentRial: 0, points: 0 };
  assert.deepEqual(['vip', 'returning', 'inactive', 'new'].map((s) => inSegment(c, s as never, at('08:00'))), [true, true, true, false]);
});

ok('tax: profit is revenue − cost of goods − expenses (Kasbai left the cost out), then the steps', () => {
  const t = taxEstimate({ revenueRial: 50_000_000_000, costRial: 10_000_000_000, expensesRial: 5_000_000_000, extraRial: 0, exemptionRial: 5_000_000_000 });
  // profit 35bn, taxable 30bn: 20bn × 15% + 10bn × 20% = 3bn + 2bn
  assert.deepEqual([t.profitRial, t.taxableRial, t.totalRial], [35_000_000_000, 30_000_000_000, 5_000_000_000]);
  assert.equal(t.steps.length, 2);
});

ok('old orders fold into daily rows: the reports do not change', () => {
  const { d, burger } = shop();
  const b = d.biz!;
  quickSale(d, { items: [{ itemId: burger.id, qty: 2 }], channel: 'walkin', pay: 'cash', at: at('12:00', '2025-06-01') });
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'cash', at: at('12:00') });
  const before = sumRows(dailyProfit(b, '2025-01-01', TODAY));
  assert.equal(compactBiz(b, TODAY), 1);
  assert.equal(b.orders.length, 1);
  assert.deepEqual(sumRows(dailyProfit(b, '2025-01-01', TODAY)), before);
  assert.equal(b.archive['2025-06-01'].orders, 1);
});

ok('backup round trip keeps the business; an old backup without one still loads', () => {
  const { d, burger } = shop();
  quickSale(d, { items: [{ itemId: burger.id, qty: 1 }], channel: 'walkin', pay: 'cash', at: at('12:00') });
  const back = normalizeData(JSON.parse(JSON.stringify(d)), TODAY);
  assert.deepEqual(back.biz, d.biz);
  const old = JSON.parse(JSON.stringify(emptyData(TODAY)));
  delete old.biz;
  assert.equal(normalizeData(old, TODAY).biz, null);
});

console.log(`\n${n} checks passed`);
