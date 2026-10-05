// کسب‌وکار من — every change to the business, as pure functions over the book (`FinanceData`).
//
// What Kasbai did with Postgres triggers (on_order_confirmed, apply_inventory_tx,
// upsert_customer_from_order, the booking EXCLUDE constraint) happens here explicitly, in one place,
// and is pinned by scripts/biz-test.ts.
//
// The link to the personal book (rule 80): the business's money lives in accounts of the book marked
// `bizId` — its till (cash) and its card/bank account. Sales paid in cash or by card are booked as ONE
// income row per day per account («فروش روز»), rebuilt whenever that day's sales change, so a busy
// shop does not fill the phone's storage with a row per sale; a credit sale moves no money until it
// is paid. Expenses and stock purchases paid from an account are expense rows; what the owner takes
// home is a transfer to a personal account.

import { BIZ_CATEGORIES, newId, tomanToRial, type FinanceData, type Iso, type Txn } from '@/lib/finance/model';
import { addDays } from '@/lib/finance/calc';
import {
  ARCHIVE_DAYS,
  LOYALTY_RIAL_PER_POINT,
  newBusiness,
  SOLD,
  type Booking,
  type BookingStatus,
  type Business,
  type BusinessType,
  type Channel,
  type CreditCustomer,
  type Customer,
  type ExpenseCat,
  type Ingredient,
  type Order,
  type OrderLine,
  type PayMethod,
  type Product,
  type Segment,
} from './model';
import { fits, freeSeat, tehranParts, type Calendar } from './slots';
import type { BomTemplate } from './templates';

const round = Math.round;

export function bizOf(d: FinanceData): Business {
  if (!d.biz) throw new Error('هنوز کسب‌وکاری تعریف نشده.');
  return d.biz;
}

// ── setup ──────────────────────────────────────────────────────────────────

export function ensureBizCategories(d: FinanceData): void {
  for (const c of BIZ_CATEGORIES) if (!d.categories.some((x) => x.id === c.id)) d.categories.push({ ...c });
}

/**
 * Sets the business up: its till as a new cash account, and its card either a new bank account, an
 * account the user already has (now marked as the business's), or none.
 */
export function setupBusiness(
  d: FinanceData,
  p: { name: string; type: BusinessType; phone?: string | null; card: 'new' | 'none' | string; now: number; today: Iso },
): string | null {
  const name = p.name.trim();
  if (!name) return 'نام کسب‌وکار را بنویسید.';
  if (d.biz) return 'کسب‌وکار از قبل تعریف شده.';
  const b = newBusiness({ id: newId('biz'), name, type: p.type, phone: p.phone, now: p.now });
  const till = { id: newId('a'), name: `صندوق ${name}`, kind: 'cash' as const, openingRial: 0, openedOn: p.today, bizId: b.id };
  d.accounts.push(till);
  b.cashAccountId = till.id;
  if (p.card === 'new') {
    const acc = { id: newId('a'), name: `کارت ${name}`, kind: 'bank' as const, openingRial: 0, openedOn: p.today, bizId: b.id };
    d.accounts.push(acc);
    b.cardAccountId = acc.id;
  } else if (p.card !== 'none') {
    const acc = d.accounts.find((a) => a.id === p.card);
    if (!acc) return 'حساب انتخاب‌شده پیدا نشد.';
    acc.bizId = b.id;
    b.cardAccountId = acc.id;
  }
  ensureBizCategories(d);
  d.biz = b;
  return null;
}

/** Which account a payment method lands in. */
export const payAccount = (b: Business, pay: PayMethod | null): string | null => (pay === 'cash' ? b.cashAccountId : pay === 'card' ? b.cardAccountId ?? b.cashAccountId : null);

// ── products, recipe (BOM) and cost ───────────────────────────────────────

export interface ProductCost {
  materialRial: number;
  laborRial: number;
  unitRial: number;
  marginRial: number;
  /** null when the price is 0 */
  marginPct: number | null;
}

/** Kasbai's product_costs view: materials from the recipe at moving-average cost + hourly rate × minutes. */
export function productCost(b: Business, p: Product): ProductCost {
  const ing = new Map(b.ingredients.map((i) => [i.id, i]));
  const materialRial = p.bom.reduce((s, l) => s + l.qty * (ing.get(l.ingredientId)?.unitCostRial ?? 0), 0);
  const laborRial = round((b.hourlyRial * p.prepMin) / 60);
  const unitRial = materialRial + laborRial;
  const marginRial = p.priceRial - unitRial;
  return { materialRial, laborRial, unitRial, marginRial, marginPct: p.priceRial > 0 ? (marginRial / p.priceRial) * 100 : null };
}

export function addProduct(b: Business, p: { name: string; priceRial: number; category?: string | null; prepMin?: number; description?: string | null; imageUrl?: string | null }, now: number): Product | string {
  const name = p.name.trim();
  if (!name) return 'نام محصول را بنویسید.';
  if (!(p.priceRial >= 0)) return 'قیمت فروش نمی‌تواند منفی باشد.';
  const prod: Product = {
    id: newId('p'),
    name,
    category: p.category?.trim() || null,
    priceRial: round(p.priceRial),
    prepMin: Math.max(0, p.prepMin ?? 0),
    description: p.description?.trim() || null,
    imageUrl: p.imageUrl?.trim() || null,
    active: true,
    bom: [],
    createdAt: now,
  };
  b.products.push(prod);
  return prod;
}

export function editProduct(b: Business, id: string, patch: Partial<Pick<Product, 'name' | 'priceRial' | 'category' | 'prepMin' | 'description' | 'imageUrl'>>): string | null {
  const p = b.products.find((x) => x.id === id);
  if (!p) return 'محصول پیدا نشد.';
  if (patch.name !== undefined && !patch.name.trim()) return 'نام محصول نمی‌تواند خالی باشد.';
  if (patch.priceRial !== undefined && !(patch.priceRial >= 0)) return 'قیمت باید صفر یا بیشتر باشد.';
  if (patch.prepMin !== undefined && !(patch.prepMin >= 0)) return 'زمان آماده‌سازی باید صفر یا بیشتر باشد.';
  Object.assign(p, {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.category !== undefined ? { category: patch.category?.trim() || null } : {}),
    ...(patch.priceRial !== undefined ? { priceRial: round(patch.priceRial) } : {}),
  });
  return null;
}

/** A product that was ever sold is archived instead, so old invoices keep their lines (Kasbai did the same). */
export function removeProduct(b: Business, id: string): 'removed' | 'archived' | null {
  const p = b.products.find((x) => x.id === id);
  if (!p) return null;
  if (b.orders.some((o) => o.lines.some((l) => l.kind === 'product' && l.itemId === id))) {
    p.active = false;
    return 'archived';
  }
  b.products = b.products.filter((x) => x.id !== id);
  return 'removed';
}

export function renameCategory(b: Business, from: string, to: string): void {
  const clean = to.trim();
  if (!clean) return;
  for (const p of b.products) if ((p.category ?? '').trim() === from) p.category = clean;
}

/** qty ≤ 0 removes the line */
export function setBomLine(b: Business, productId: string, ingredientId: string, qty: number): string | null {
  const p = b.products.find((x) => x.id === productId);
  if (!p) return 'محصول پیدا نشد.';
  if (!b.ingredients.some((i) => i.id === ingredientId)) return 'ماده اولیه پیدا نشد.';
  p.bom = p.bom.filter((l) => l.ingredientId !== ingredientId);
  if (qty > 0) p.bom.push({ ingredientId, qty });
  return null;
}

/** One tap: the product, any missing ingredients (by name), and the recipe. */
export function applyTemplate(b: Business, t: BomTemplate, now: number): Product {
  const prod = addProduct(b, { name: t.productName, priceRial: tomanToRial(t.suggestedPrice), category: t.category, prepMin: t.prepMin ?? 0 }, now) as Product;
  for (const ti of t.ingredients) {
    let ing = b.ingredients.find((i) => i.name === ti.name);
    if (!ing) {
      ing = { id: newId('g'), name: ti.name, unit: ti.unit, unitCostRial: 0, stock: 0, reorder: ti.reorder_point, createdAt: now };
      b.ingredients.push(ing);
    }
    prod.bom.push({ ingredientId: ing.id, qty: ti.quantity });
  }
  return prod;
}

/** Rows of a spreadsheet (نام · دسته · قیمت فروش · زمان آماده‌سازی) — the toman price as in Kasbai's template. */
export function importProducts(b: Business, rows: Record<string, unknown>[], now: number): { created: number; updated: number; failed: number; skipped: number } {
  const res = { created: 0, updated: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    const name = String(row['نام'] ?? '').trim();
    if (!name) {
      res.skipped++;
      continue;
    }
    const price = Number(String(row['قیمت فروش'] ?? '').replace(/[,٬\s]/g, ''));
    const prep = Number(row['زمان آماده‌سازی (دقیقه)'] ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      res.failed++;
      continue;
    }
    const category = String(row['دسته'] ?? '').trim() || null;
    const existing = b.products.find((p) => p.name === name);
    if (existing) {
      editProduct(b, existing.id, { category, priceRial: tomanToRial(price), prepMin: Number.isFinite(prep) && prep >= 0 ? prep : existing.prepMin });
      res.updated++;
    } else {
      addProduct(b, { name, category, priceRial: tomanToRial(price), prepMin: Number.isFinite(prep) && prep >= 0 ? prep : 0 }, now);
      res.created++;
    }
  }
  return res;
}

// ── stock ──────────────────────────────────────────────────────────────────

export function addIngredient(b: Business, p: { name: string; unit: string; reorder?: number }, now: number): Ingredient | string {
  const name = p.name.trim();
  if (!name) return 'نام ماده را بنویسید.';
  if (b.ingredients.some((i) => i.name === name)) return `«${name}» قبلاً هست.`;
  if ((p.reorder ?? 0) < 0) return 'نقطه سفارش نمی‌تواند منفی باشد.';
  const ing: Ingredient = { id: newId('g'), name, unit: p.unit.trim() || 'عدد', unitCostRial: 0, stock: 0, reorder: p.reorder ?? 0, createdAt: now };
  b.ingredients.push(ing);
  return ing;
}

/** Name/unit/reorder, and a stock count: a different count is booked as an adjustment, not overwritten silently. */
export function editIngredient(b: Business, id: string, patch: { name?: string; unit?: string; reorder?: number; stock?: number; unitCostRial?: number }, now: number): string | null {
  const ing = b.ingredients.find((x) => x.id === id);
  if (!ing) return 'ماده پیدا نشد.';
  if (patch.name !== undefined && !patch.name.trim()) return 'نام ماده نمی‌تواند خالی باشد.';
  if (patch.reorder !== undefined && patch.reorder < 0) return 'نقطه سفارش نمی‌تواند منفی باشد.';
  if (patch.stock !== undefined && !(patch.stock >= 0)) return 'موجودی باید صفر یا بیشتر باشد.';
  if (patch.unitCostRial !== undefined && !(patch.unitCostRial >= 0)) return 'قیمت خرید باید صفر یا بیشتر باشد.';
  if (patch.name !== undefined) ing.name = patch.name.trim();
  if (patch.unit !== undefined) ing.unit = patch.unit.trim() || ing.unit;
  if (patch.reorder !== undefined) ing.reorder = patch.reorder;
  if (patch.unitCostRial !== undefined) ing.unitCostRial = patch.unitCostRial;
  if (patch.stock !== undefined) {
    const diff = patch.stock - ing.stock;
    if (Math.abs(diff) > 0.0005) {
      ing.stock = patch.stock;
      b.invTx.push({ id: newId('v'), ingredientId: id, type: 'adjustment', qty: diff, note: 'اصلاح دستی موجودی', at: now, date: tehranParts(now).date });
    }
  }
  return null;
}

/** Removing an ingredient also takes it out of every recipe; returns the products it was in. */
export function removeIngredient(b: Business, id: string): string[] {
  const usedIn = b.products.filter((p) => p.bom.some((l) => l.ingredientId === id)).map((p) => p.name);
  for (const p of b.products) p.bom = p.bom.filter((l) => l.ingredientId !== id);
  b.ingredients = b.ingredients.filter((i) => i.id !== id);
  b.invTx = b.invTx.filter((t) => t.ingredientId !== id || t.txnId);
  return usedIn;
}

/**
 * A purchase: stock up, the unit cost becomes the moving average (Kasbai's apply_inventory_tx), and
 * — when paid from an account — an expense row in the book.
 */
export function addPurchase(d: FinanceData, p: { ingredientId: string; qty: number; unitCostRial: number; accountId?: string | null; date: Iso; note?: string | null }, now: number): string | null {
  const b = bizOf(d);
  const ing = b.ingredients.find((i) => i.id === p.ingredientId);
  if (!ing) return 'ماده پیدا نشد.';
  if (!(p.qty > 0)) return 'مقدار خرید باید بیشتر از صفر باشد.';
  if (!(p.unitCostRial >= 0)) return 'قیمت واحد نمی‌تواند منفی باشد.';
  const old = Math.max(0, ing.stock);
  ing.unitCostRial = old + p.qty > 0 ? (old * ing.unitCostRial + p.qty * p.unitCostRial) / (old + p.qty) : p.unitCostRial;
  ing.stock += p.qty;
  const tx = { id: newId('v'), ingredientId: ing.id, type: 'purchase' as const, qty: p.qty, unitCostRial: p.unitCostRial, note: p.note ?? null, at: now, date: p.date, txnId: null as string | null };
  const total = round(p.qty * p.unitCostRial);
  if (p.accountId && total > 0) {
    const t: Txn = { id: newId('t'), date: p.date, kind: 'expense', amountRial: total, accountId: p.accountId, categoryId: 'c-bizbuy', note: `خرید ${ing.name}`, link: { type: 'biz', id: tx.id } };
    d.txns.push(t);
    tx.txnId = t.id;
  }
  b.invTx.push(tx);
  return null;
}

export function addWaste(b: Business, ingredientId: string, qty: number, note: string | null, now: number): string | null {
  const ing = b.ingredients.find((i) => i.id === ingredientId);
  if (!ing) return 'ماده پیدا نشد.';
  if (!(qty > 0)) return 'مقدار باید بیشتر از صفر باشد.';
  ing.stock -= qty;
  b.invTx.push({ id: newId('v'), ingredientId, type: 'waste', qty: -qty, note, at: now, date: tehranParts(now).date });
  return null;
}

// ── orders ─────────────────────────────────────────────────────────────────

export function activeDiscounts(b: Business, today: Iso) {
  return b.discounts.filter((x) => x.active && x.from <= today && x.to >= today);
}

/** subtotal − discount + VAT on what is left, as Kasbai's on_order_confirmed computed it */
export function orderTotals(lines: Pick<OrderLine, 'qty' | 'unitRial'>[], discountPct: number, vatPct: number) {
  const subtotalRial = lines.reduce((s, l) => s + l.qty * l.unitRial, 0);
  const discountRial = round((subtotalRial * discountPct) / 100);
  const vatRial = round(((subtotalRial - discountRial) * vatPct) / 100);
  return { subtotalRial, discountRial, vatRial, totalRial: subtotalRial - discountRial + vatRial };
}

export interface NewOrder {
  items: { itemId: string; kind?: 'product' | 'service'; qty: number; unitRial?: number }[];
  channel: Channel;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  discountId?: string | null;
  at: number;
  ref?: string | null;
  bookingId?: string | null;
}

/** A pending order: prices as they are now; money, stock and the customer change only on confirmation. */
export function createOrder(b: Business, p: NewOrder): Order | string {
  const lines: OrderLine[] = [];
  for (const it of p.items) {
    if (!(it.qty > 0)) continue;
    const kind = it.kind ?? 'product';
    const src = kind === 'service' ? b.services.find((s) => s.id === it.itemId) : b.products.find((x) => x.id === it.itemId);
    if (!src) return 'یکی از اقلام دیگر وجود ندارد.';
    lines.push({ itemId: it.itemId, kind, name: src.name, qty: Math.round(it.qty), unitRial: it.unitRial ?? src.priceRial, costRial: 0 });
  }
  if (!lines.length) return 'حداقل یک قلم انتخاب کنید.';
  const today = tehranParts(p.at).date;
  const disc = p.discountId ? activeDiscounts(b, today).find((x) => x.id === p.discountId) : undefined;
  const t = orderTotals(lines, disc?.pct ?? 0, b.vatPct);
  const { date, time } = tehranParts(p.at);
  const o: Order = {
    id: newId('o'),
    no: b.nextNo++,
    at: p.at,
    date,
    time,
    channel: p.channel,
    status: 'pending',
    customerName: p.customerName?.trim() || null,
    customerPhone: normPhone(p.customerPhone),
    note: p.note?.trim() || null,
    lines,
    discountTitle: disc?.title ?? null,
    discountPct: disc?.pct ?? 0,
    vatPct: b.vatPct,
    ...t,
    costRial: 0,
    pay: null,
    ref: p.ref ?? null,
    bookingId: p.bookingId ?? null,
  };
  b.orders.push(o);
  return o;
}

export function normPhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('98') && digits.length === 12) return '0' + digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) return '0' + digits;
  return digits;
}

/**
 * Confirmation is the sale (Kasbai's on_order_confirmed): cost of each line frozen, totals
 * recomputed, the recipe's ingredients taken out of stock, the customer club updated, and the money
 * — cash or card into the business's account in the book; credit into the credit book.
 */
export function confirmOrder(d: FinanceData, orderId: string, pay: PayMethod, at: number, opts: { creditId?: string | null } = {}): string | null {
  const b = bizOf(d);
  const o = b.orders.find((x) => x.id === orderId);
  if (!o) return 'سفارش پیدا نشد.';
  if (o.status !== 'pending') return 'این سفارش قبلاً تأیید یا لغو شده.';
  if (pay !== 'credit' && !payAccount(b, pay)) return 'برای این روش پرداخت حسابی در دفتر تعیین نشده (تنظیمات کسب‌وکار).';
  let creditId: string | null = null;
  if (pay === 'credit') {
    creditId = opts.creditId ?? null;
    if (!creditId) {
      const name = o.customerName || o.customerPhone;
      if (!name) return 'برای نسیه، نام مشتری یا یک بدهکار دفتر نسیه را انتخاب کنید.';
      const c = b.credit.find((x) => (o.customerPhone && x.phone === o.customerPhone) || x.name === name);
      creditId = c ? c.id : addCreditCustomer(b, name, o.customerPhone ?? null, null, at).id;
    }
    if (!b.credit.some((c) => c.id === creditId)) return 'بدهکار نسیه پیدا نشد.';
  }

  const prods = new Map(b.products.map((p) => [p.id, p]));
  for (const l of o.lines) l.costRial = l.kind === 'product' && prods.get(l.itemId) ? round(productCost(b, prods.get(l.itemId)!).unitRial) : 0;
  Object.assign(o, orderTotals(o.lines, o.discountPct, o.vatPct));
  o.costRial = o.lines.reduce((s, l) => s + l.qty * l.costRial, 0);

  // stock: one consumption per ingredient
  const use = new Map<string, number>();
  for (const l of o.lines) {
    const p = l.kind === 'product' ? prods.get(l.itemId) : undefined;
    for (const r of p?.bom ?? []) use.set(r.ingredientId, (use.get(r.ingredientId) ?? 0) + r.qty * l.qty);
  }
  const { date, time } = tehranParts(at);
  o.consumed = [];
  for (const [ingredientId, qty] of use) {
    const ing = b.ingredients.find((i) => i.id === ingredientId);
    if (!ing) continue;
    ing.stock -= qty;
    o.consumed.push({ ingredientId, qty });
    b.invTx.push({ id: newId('v'), ingredientId, type: 'consumption', qty: -qty, orderId: o.id, note: `فاکتور ${o.no}`, at, date });
  }

  o.status = 'confirmed';
  o.pay = pay;
  o.saleDate = date;
  o.saleTime = time;
  if (o.customerPhone) touchCustomer(b, o.customerPhone, o.customerName ?? null, o.totalRial, at, +1);
  if (pay === 'credit') {
    o.creditId = creditId;
    addCreditSale(b, creditId!, o.totalRial, `فاکتور ${o.no}`, at, o.id);
  }
  syncSales(d, date);
  return null;
}

export function setOrderStatus(b: Business, orderId: string, status: 'preparing' | 'delivered'): string | null {
  const o = b.orders.find((x) => x.id === orderId);
  if (!o) return 'سفارش پیدا نشد.';
  if (!SOLD.includes(o.status)) return 'اول سفارش را تأیید کنید.';
  o.status = status;
  return null;
}

/** Cancel: a sale is undone exactly — stock back, the customer's totals, the credit entry, the day's money. */
export function cancelOrder(d: FinanceData, orderId: string, at: number): string | null {
  const b = bizOf(d);
  const o = b.orders.find((x) => x.id === orderId);
  if (!o) return 'سفارش پیدا نشد.';
  if (o.status === 'canceled') return null;
  const wasSold = SOLD.includes(o.status);
  o.status = 'canceled';
  if (!wasSold) return null;
  const { date } = tehranParts(at);
  for (const c of o.consumed ?? []) {
    const ing = b.ingredients.find((i) => i.id === c.ingredientId);
    if (!ing) continue;
    ing.stock += c.qty;
    b.invTx.push({ id: newId('v'), ingredientId: c.ingredientId, type: 'return', qty: c.qty, orderId: o.id, note: `لغو فاکتور ${o.no}`, at, date });
  }
  if (o.customerPhone) touchCustomer(b, o.customerPhone, null, o.totalRial, at, -1);
  if (o.pay === 'credit' && o.creditId) {
    const c = b.credit.find((x) => x.id === o.creditId);
    if (c) c.entries = c.entries.filter((e) => e.orderId !== o.id);
  }
  if (o.saleDate) syncSales(d, o.saleDate);
  return null;
}

/** The till: create, confirm and (optionally) mark delivered in one go. */
export function quickSale(d: FinanceData, p: NewOrder & { pay: PayMethod; deliver?: boolean; creditId?: string | null }): Order | string {
  const b = bizOf(d);
  const o = createOrder(b, p);
  if (typeof o === 'string') return o;
  const err = confirmOrder(d, o.id, p.pay, p.at, { creditId: p.creditId });
  if (err) {
    b.orders = b.orders.filter((x) => x.id !== o.id);
    b.nextNo--;
    return err;
  }
  if (p.deliver) o.status = 'delivered';
  return o;
}

// ── the day's sales in the book ───────────────────────────────────────────

const salesKey = (date: Iso) => `sales:${date}`;

/** One «فروش روز» income row per account per day = cash/card sales of that day; created, resized or removed. */
export function syncSales(d: FinanceData, date: Iso): void {
  const b = d.biz;
  if (!b) return;
  const sums = new Map<string, { rial: number; time: string; n: number }>();
  for (const o of b.orders) {
    if (!SOLD.includes(o.status) || o.saleDate !== date || (o.pay !== 'cash' && o.pay !== 'card')) continue;
    const acc = payAccount(b, o.pay);
    if (!acc) continue;
    const s = sums.get(acc) ?? { rial: 0, time: '00:00', n: 0 };
    s.rial += o.totalRial;
    s.n++;
    if ((o.saleTime ?? '') > s.time) s.time = o.saleTime!;
    sums.set(acc, s);
  }
  const mk = salesKey(date);
  const mine = (t: Txn) => t.link?.type === 'biz' && t.link.id === b.id && t.link.mk === mk;
  for (const t of d.txns.filter(mine)) {
    if (!sums.has(t.accountId) || b.skipBook.includes(`${date}|${t.accountId}`)) d.txns = d.txns.filter((x) => x.id !== t.id);
  }
  for (const [accountId, s] of sums) {
    if (b.skipBook.includes(`${date}|${accountId}`) || s.rial <= 0) continue;
    const note = `فروش روز ${b.name} (${s.n.toLocaleString('fa-IR')} فاکتور)`;
    const t = d.txns.find((x) => mine(x) && x.accountId === accountId);
    // the time of the day's last sale: a bank balance stated before it does not already include it (balance.ts)
    if (t) Object.assign(t, { amountRial: s.rial, time: s.time, note });
    else d.txns.push({ id: newId('t'), date, time: s.time, kind: 'income', amountRial: s.rial, accountId, categoryId: 'i-biz', note, link: { type: 'biz', id: b.id, mk } });
  }
}

/** Book the day again after the user removed it from the transactions list. */
export function rebookDay(d: FinanceData, date: Iso): void {
  const b = bizOf(d);
  b.skipBook = b.skipBook.filter((k) => !k.startsWith(`${date}|`));
  syncSales(d, date);
}

/** Called by deleteTxn: the business forgets what that row stood for. */
export function forgetBizTxn(d: FinanceData, t: Txn): void {
  const b = d.biz;
  if (!b || t.link?.type !== 'biz') return;
  if (t.link.mk?.startsWith('sales:')) {
    const key = `${t.link.mk.slice(6)}|${t.accountId}`;
    if (!b.skipBook.includes(key)) b.skipBook.push(key);
    return;
  }
  b.expenses = b.expenses.filter((e) => e.txnId !== t.id);
  for (const v of b.invTx) if (v.txnId === t.id) v.txnId = null;
  for (const c of b.credit) c.entries = c.entries.filter((e) => e.txnId !== t.id);
}

// ── customers ──────────────────────────────────────────────────────────────

function touchCustomer(b: Business, phone: string, name: string | null, totalRial: number, at: number, sign: 1 | -1): void {
  const points = Math.floor(totalRial / LOYALTY_RIAL_PER_POINT);
  let c = b.customers.find((x) => x.phone === phone);
  if (!c) {
    if (sign < 0) return;
    c = { id: newId('k'), phone, name, firstAt: at, lastAt: at, orders: 0, spentRial: 0, points: 0 };
    b.customers.push(c);
  }
  c.orders = Math.max(0, c.orders + sign);
  c.spentRial = Math.max(0, c.spentRial + sign * totalRial);
  c.points = Math.max(0, c.points + sign * points);
  if (sign > 0) {
    c.lastAt = Math.max(c.lastAt, at);
    if (!c.name && name) c.name = name;
  }
}

/** Kasbai's segments */
export function inSegment(c: Customer, seg: Segment, now: number): boolean {
  if (seg === 'vip') return c.spentRial >= 20_000_000 || c.orders >= 5;
  if (seg === 'returning') return c.orders >= 2;
  if (seg === 'inactive') return now - c.lastAt >= 30 * 86_400_000;
  if (seg === 'new') return c.orders <= 1;
  return true;
}

// ── credit book (نسیه) ────────────────────────────────────────────────────

export const creditBalance = (c: CreditCustomer) => c.entries.reduce((s, e) => s + (e.kind === 'sale' ? e.amountRial : -e.amountRial), 0);

export function addCreditCustomer(b: Business, name: string, phone: string | null, note: string | null, now: number): CreditCustomer {
  const c: CreditCustomer = { id: newId('n'), name: name.trim(), phone: normPhone(phone), note: note?.trim() || null, createdAt: now, entries: [] };
  b.credit.push(c);
  return c;
}

export function addCreditSale(b: Business, creditId: string, amountRial: number, note: string | null, at: number, orderId?: string | null): string | null {
  const c = b.credit.find((x) => x.id === creditId);
  if (!c) return 'بدهکار پیدا نشد.';
  if (!(amountRial > 0)) return 'مبلغ را بنویسید.';
  c.entries.push({ id: newId('e'), kind: 'sale', amountRial: round(amountRial), note, at, date: tehranParts(at).date, orderId: orderId ?? null });
  return null;
}

/** A payment received: off the debt, and — when it went into an account — income in the book. */
export function addCreditPayment(d: FinanceData, creditId: string, amountRial: number, accountId: string | null, note: string | null, at: number): string | null {
  const b = bizOf(d);
  const c = b.credit.find((x) => x.id === creditId);
  if (!c) return 'بدهکار پیدا نشد.';
  if (!(amountRial > 0)) return 'مبلغ را بنویسید.';
  const date = tehranParts(at).date;
  const e = { id: newId('e'), kind: 'payment' as const, amountRial: round(amountRial), note, at, date, txnId: null as string | null };
  if (accountId) {
    const t: Txn = { id: newId('t'), date, kind: 'income', amountRial: e.amountRial, accountId, categoryId: 'i-biz', note: `وصول نسیه ${c.name}`, link: { type: 'biz', id: e.id } };
    d.txns.push(t);
    e.txnId = t.id;
  }
  c.entries.push(e);
  return null;
}

export function deleteCreditEntry(d: FinanceData, creditId: string, entryId: string): void {
  const c = bizOf(d).credit.find((x) => x.id === creditId);
  const e = c?.entries.find((x) => x.id === entryId);
  if (!c || !e) return;
  c.entries = c.entries.filter((x) => x.id !== entryId);
  if (e.txnId) d.txns = d.txns.filter((t) => t.id !== e.txnId);
}

/** The person and their entries go; money already received stays in the book (it did come in). */
export function deleteCreditCustomer(d: FinanceData, creditId: string): void {
  const b = bizOf(d);
  const c = b.credit.find((x) => x.id === creditId);
  if (!c) return;
  const ids = new Set(c.entries.map((e) => e.txnId).filter(Boolean));
  for (const t of d.txns) if (ids.has(t.id)) t.link = null;
  b.credit = b.credit.filter((x) => x.id !== creditId);
}

// ── expenses and the owner's draw ─────────────────────────────────────────

export function addExpense(d: FinanceData, p: { category: ExpenseCat; amountRial: number; date: Iso; note?: string | null; accountId?: string | null }): string | null {
  const b = bizOf(d);
  if (!(p.amountRial > 0)) return 'مبلغ را بنویسید.';
  const e = { id: newId('x'), category: p.category, amountRial: round(p.amountRial), date: p.date, note: p.note?.trim() || null, accountId: p.accountId ?? null, txnId: null as string | null };
  if (p.accountId) {
    const t: Txn = { id: newId('t'), date: p.date, kind: 'expense', amountRial: e.amountRial, accountId: p.accountId, categoryId: 'c-biz', note: e.note ?? `هزینه ${b.name}`, link: { type: 'biz', id: e.id } };
    d.txns.push(t);
    e.txnId = t.id;
  }
  b.expenses.push(e);
  return null;
}

export function deleteExpense(d: FinanceData, id: string): void {
  const b = bizOf(d);
  const e = b.expenses.find((x) => x.id === id);
  if (!e) return;
  b.expenses = b.expenses.filter((x) => x.id !== id);
  if (e.txnId) d.txns = d.txns.filter((t) => t.id !== e.txnId);
}

/** What the owner takes home: a transfer from the business's account to a personal one (personal income, calc.ts). */
export function ownerDraw(d: FinanceData, fromAccountId: string, toAccountId: string, amountRial: number, date: Iso): string | null {
  const from = d.accounts.find((a) => a.id === fromAccountId);
  const to = d.accounts.find((a) => a.id === toAccountId);
  if (!from?.bizId) return 'حساب مبدأ باید حساب کسب‌وکار باشد.';
  if (!to || to.bizId) return 'حساب مقصد باید حساب شخصی باشد.';
  if (!(amountRial > 0)) return 'مبلغ را بنویسید.';
  d.txns.push({ id: newId('t'), date, kind: 'transfer', amountRial: round(amountRial), accountId: from.id, toAccountId: to.id, note: 'برداشت صاحب کار' });
  return null;
}

// ── services and bookings ─────────────────────────────────────────────────

export function calendarOf(b: Business, excludeId?: string | null): Calendar {
  return {
    hours: b.hours,
    shifts: b.shifts,
    seatIds: b.seats.filter((s) => s.active).map((s) => s.id),
    busy: b.bookings.filter((x) => x.status !== 'canceled' && x.id !== excludeId).map((x) => ({ id: x.id, startsAt: x.startsAt, durationMin: x.durationMin, seatId: x.seatId ?? null })),
  };
}

export function addBooking(
  b: Business,
  p: { serviceIds: string[]; customerName?: string | null; customerPhone: string; startsAt: number; seatId?: string | null; party?: number; source: Booking['source']; note?: string | null; status?: BookingStatus; ref?: string | null },
  now: number,
): Booking | string {
  const svcs = p.serviceIds.map((id) => b.services.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  if (!svcs.length) return 'حداقل یک خدمت انتخاب کنید.';
  // a booking taken in the shop (or by voice) may have no number; one from the online shop always has one
  const phone = normPhone(p.customerPhone);
  if (!phone && p.source !== 'manual') return 'شماره تماس مشتری را بنویسید.';
  if (!phone && !p.customerName?.trim()) return 'نام یا شماره تماس مشتری را بنویسید.';
  const durationMin = svcs.reduce((s, x) => s + x.durationMin, 0);
  const cal = calendarOf(b);
  let seatId = p.seatId ?? null;
  if (!fits(cal, p.startsAt, durationMin, seatId)) return 'این زمان با نوبت دیگری تداخل دارد.';
  if (!seatId && cal.seatIds.length) seatId = freeSeat(cal, p.startsAt, durationMin);
  const bk: Booking = {
    id: newId('r'),
    serviceIds: svcs.map((s) => s.id),
    serviceNames: svcs.map((s) => s.name),
    customerName: p.customerName?.trim() || null,
    customerPhone: phone ?? '',
    startsAt: p.startsAt,
    durationMin,
    priceRial: svcs.reduce((s, x) => s + x.priceRial, 0),
    seatId,
    party: Math.max(1, p.party ?? 1),
    status: p.status ?? 'confirmed',
    source: p.source,
    note: p.note?.trim() || null,
    createdAt: now,
    ref: p.ref ?? null,
  };
  b.bookings.push(bk);
  return bk;
}

/** Kasbai refused moving a booking less than two hours before it; the owner then calls the customer. */
export const RESCHEDULE_CUTOFF_MS = 2 * 3_600_000;

export function rescheduleBooking(b: Business, id: string, startsAt: number, now: number): string | null {
  const bk = b.bookings.find((x) => x.id === id);
  if (!bk) return 'نوبت پیدا نشد.';
  if (bk.status === 'canceled' || bk.status === 'done') return 'این نوبت قابل جابه‌جایی نیست.';
  if (startsAt < now) return 'زمان انتخابی گذشته است.';
  if (bk.startsAt - now < RESCHEDULE_CUTOFF_MS) return 'کمتر از دو ساعت به این نوبت مانده؛ مستقیم با مشتری هماهنگ کنید.';
  if (!fits(calendarOf(b, id), startsAt, bk.durationMin, bk.seatId)) return 'این زمان با نوبت دیگری تداخل دارد.';
  bk.originalStartsAt ??= bk.startsAt;
  bk.startsAt = startsAt;
  return null;
}

export function assignSeat(b: Business, id: string, seatId: string | null): string | null {
  const bk = b.bookings.find((x) => x.id === id);
  if (!bk) return 'نوبت پیدا نشد.';
  if (seatId && !fits(calendarOf(b, id), bk.startsAt, bk.durationMin, seatId)) return 'این مورد در آن زمان پر است.';
  bk.seatId = seatId;
  return null;
}

/**
 * «انجام شد» is a sale (Kasbai never booked the money of a service; a salon's revenue lives here):
 * an order on the booking channel with the services as lines, confirmed with the payment method.
 */
export function setBookingStatus(d: FinanceData, id: string, status: BookingStatus, at: number, pay?: PayMethod): string | null {
  const b = bizOf(d);
  const bk = b.bookings.find((x) => x.id === id);
  if (!bk) return 'نوبت پیدا نشد.';
  if (status === 'done') {
    if (bk.status === 'done') return null;
    if (!pay) return 'روش پرداخت را انتخاب کنید.';
    const o = createOrder(b, {
      items: bk.serviceIds.map((sid) => ({ itemId: sid, kind: 'service' as const, qty: 1 })),
      channel: 'booking',
      customerName: bk.customerName,
      customerPhone: bk.customerPhone,
      at,
      bookingId: bk.id,
    });
    if (typeof o === 'string') return o;
    const err = confirmOrder(d, o.id, pay, at);
    if (err) {
      b.orders = b.orders.filter((x) => x.id !== o.id);
      b.nextNo--;
      return err;
    }
    o.status = 'delivered';
    bk.orderId = o.id;
  } else if (bk.status === 'done' && bk.orderId) {
    cancelOrder(d, bk.orderId, at);
    bk.orderId = null;
  }
  if (status === 'canceled') bk.canceledBy = 'business';
  bk.status = status;
  return null;
}

// ── keeping the book small ────────────────────────────────────────────────

/** Orders older than ARCHIVE_DAYS fold into one row per day; old stock movements are dropped (the stock stays). */
export function compactBiz(b: Business, today: Iso): number {
  const cutoff = addDays(today, -ARCHIVE_DAYS);
  let n = 0;
  const keep: Order[] = [];
  for (const o of b.orders) {
    const day = o.saleDate ?? o.date;
    if (day >= cutoff || o.status === 'pending') {
      keep.push(o);
      continue;
    }
    n++;
    if (!SOLD.includes(o.status)) continue;
    const s = (b.archive[day] ??= { revenueRial: 0, costRial: 0, discountRial: 0, vatRial: 0, orders: 0 });
    s.revenueRial += o.totalRial - o.vatRial;
    s.costRial += o.costRial;
    s.discountRial += o.discountRial;
    s.vatRial += o.vatRial;
    s.orders++;
  }
  b.orders = keep;
  b.invTx = b.invTx.filter((t) => t.date >= cutoff);
  b.bookings = b.bookings.filter((x) => x.startsAt >= Date.UTC(+cutoff.slice(0, 4), +cutoff.slice(5, 7) - 1, +cutoff.slice(8, 10)) || x.status === 'pending');
  return n;
}
