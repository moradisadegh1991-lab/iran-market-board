// لیست خرید روزمره — the pure half (rule 100).
//
// Write what to buy; tick each thing as it goes in the basket (with its price, if you like); then book the
// trip into the book as ONE expense — that is how the bank sees it, one card payment per shop. If the bank's
// SMS of that payment is already booked (the «نوعش چیست؟» notification) or waiting in the queue, the trip
// becomes that transaction instead of a second one (the pattern of دنگ and قرض, rules 78 and 88). Booked
// items leave the list; what was bought is remembered for quick adding next time.
import { addDays } from './calc';
import { commitStaged, norm } from './importers';
import { newId, type FinanceData, type Iso, type ShoppingItem, type Staged, type Txn } from './model';

/** everyday things, offered while typing until the user's own history takes over */
export const COMMON_ITEMS = [
  'نان', 'شیر', 'ماست', 'پنیر', 'تخم‌مرغ', 'کره', 'میوه', 'سبزی', 'گوجه‌فرنگی', 'سیب‌زمینی', 'پیاز', 'خیار', 'برنج', 'روغن', 'مرغ',
  'گوشت', 'ماکارونی', 'حبوبات', 'قند', 'شکر', 'چای', 'نمک', 'رب گوجه', 'آب معدنی', 'دستمال کاغذی', 'مایع ظرفشویی', 'پودر لباسشویی',
  'شامپو', 'صابون', 'خمیردندان', 'پوشک', 'کیسه زباله',
];

const key = (name: string) => norm(name).replace(/\s+/g, ' ').trim();

export const listItems = (d: FinanceData) => (d.shopping ?? []).filter((x) => !x.txnId);
/** ticked and not yet booked */
export const boughtItems = (d: FinanceData) => listItems(d).filter((x) => x.done);

/** Adds a thing to buy; one already on the list (not bought yet) is returned instead of a second copy. */
export function addItem(d: FinanceData, inp: { name: string; qty?: string; estRial?: number | null }, now = Date.now()): ShoppingItem | string {
  const name = inp.name.replace(/\s+/g, ' ').trim();
  if (!name) return 'چه چیزی بخرید؟ نامش را بنویسید.';
  if (inp.estRial !== undefined && inp.estRial !== null && !(Number.isFinite(inp.estRial) && inp.estRial >= 0)) return 'مبلغ تخمینی نامعتبر است.';
  d.shopping ??= [];
  const same = listItems(d).find((x) => !x.done && key(x.name) === key(name));
  if (same) {
    if (inp.qty?.trim() && !same.qty) same.qty = inp.qty.trim();
    if (inp.estRial && !same.estRial) same.estRial = Math.round(inp.estRial);
    return same;
  }
  const it: ShoppingItem = { id: newId('s'), name, qty: inp.qty?.trim() || undefined, estRial: inp.estRial ? Math.round(inp.estRial) : null, addedAt: now };
  d.shopping.push(it);
  return it;
}

/** Ticks (bought, optionally with what it cost) or unticks an item. */
export function setBought(d: FinanceData, id: string, done: boolean, priceRial?: number | null, now = Date.now()): void {
  const it = listItems(d).find((x) => x.id === id);
  if (!it) return;
  it.done = done;
  it.doneAt = done ? now : null;
  if (done && priceRial !== undefined) it.priceRial = priceRial && priceRial > 0 ? Math.round(priceRial) : null;
  if (!done) it.priceRial = null;
}

export function editItem(d: FinanceData, id: string, patch: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'estRial' | 'priceRial'>>): void {
  const it = listItems(d).find((x) => x.id === id);
  if (!it) return;
  if (patch.name !== undefined && patch.name.trim()) it.name = patch.name.replace(/\s+/g, ' ').trim();
  if (patch.qty !== undefined) it.qty = patch.qty.trim() || undefined;
  if (patch.estRial !== undefined) it.estRial = patch.estRial && patch.estRial > 0 ? Math.round(patch.estRial) : null;
  if (patch.priceRial !== undefined) it.priceRial = patch.priceRial && patch.priceRial > 0 ? Math.round(patch.priceRial) : null;
}

export function removeItem(d: FinanceData, id: string): void {
  d.shopping = (d.shopping ?? []).filter((x) => x.id !== id);
}

/** What the list adds up to: estimates of what is left, prices of what is in the basket. */
export function listTotals(d: FinanceData): { left: number; leftEstRial: number; leftUnpriced: number; bought: number; boughtRial: number; boughtUnpriced: number } {
  const items = listItems(d);
  const left = items.filter((x) => !x.done);
  const bought = items.filter((x) => x.done);
  return {
    left: left.length,
    leftEstRial: left.reduce((s, x) => s + (x.estRial ?? 0), 0),
    leftUnpriced: left.filter((x) => !x.estRial).length,
    bought: bought.length,
    boughtRial: bought.reduce((s, x) => s + (x.priceRial ?? 0), 0),
    boughtUnpriced: bought.filter((x) => !x.priceRial).length,
  };
}

/** Suggestions while typing: what the user buys most, then common things; never what is already on the list. */
export function suggestItems(d: FinanceData, typed: string, max = 8): string[] {
  const t = key(typed);
  const on = new Set(listItems(d).filter((x) => !x.done).map((x) => key(x.name)));
  const freq = d.shoppingFreq ?? {};
  const mine = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || a.localeCompare(b, 'fa'));
  const out: string[] = [];
  for (const n of [...mine, ...COMMON_ITEMS]) {
    const k = key(n);
    if (on.has(k) || out.some((x) => key(x) === k)) continue;
    if (t && !k.includes(t)) continue;
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** «لیست خرید: نان، شیر (۲ لیتر)، …» for the transaction's note */
export function purchaseNote(items: ShoppingItem[]): string {
  const parts = items.map((x) => (x.qty ? `${x.name} (${x.qty})` : x.name));
  const s = `لیست خرید: ${parts.join('، ')}`;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/**
 * The bank's record of this payment, if it is already here: a booked expense of the same amount within 2 days
 * that is not tied to something else, or a queued SMS row of the same amount (a withdrawal, or unstated).
 */
export function purchaseMatches(d: FinanceData, amountRial: number, date: Iso): { txns: Txn[]; staged: Staged[] } {
  const amt = Math.round(amountRial);
  const near = (x: Iso | null) => !!x && x >= addDays(date, -2) && x <= addDays(date, 2);
  return {
    txns: d.txns.filter((t) => t.kind === 'expense' && t.amountRial === amt && !t.link && near(t.date) && !/^لیست خرید:/.test(t.note ?? '')).slice(-5),
    staged: d.inbox.filter((s) => s.amountRial === amt && s.direction !== 'in' && near(s.date ?? null) && !s.balanceOnly).slice(0, 5),
  };
}

export interface PurchaseInput {
  itemIds: string[];
  amountRial: number;
  accountId: string;
  categoryId: string | null;
  date: Iso;
  /** this is the bank's already-booked transaction (purchaseMatches) */
  linkTxnId?: string | null;
  /** this is the bank's SMS waiting in the queue (purchaseMatches) */
  stagedId?: string | null;
}

/** what bookPurchase did, so «برگرداندن» can undo exactly that */
export interface PurchaseReceipt {
  txnId: string;
  /** how the transaction came to be: made here, taken over from the queue, or an existing one renamed */
  how: 'new' | 'staged' | 'linked';
  before?: Pick<Txn, 'note' | 'categoryId'>;
  staged?: Staged;
  items: ShoppingItem[];
  freq: Record<string, number>;
}

/**
 * Books the ticked items as one expense. Prices are optional; the amount booked is what the user confirms
 * (prefilled with the sum of the prices). Returns an error message and changes nothing when incomplete.
 */
export function bookPurchase(d: FinanceData, inp: PurchaseInput, now = Date.now()): PurchaseReceipt | string {
  const items = listItems(d).filter((x) => inp.itemIds.includes(x.id));
  if (!items.length) return 'هیچ قلمی برای ثبت انتخاب نشده.';
  const amountRial = Math.round(inp.amountRial);
  if (!(amountRial > 0)) return 'مبلغ کل خرید را بنویسید.';
  if (!d.accounts.some((a) => a.id === inp.accountId)) return 'از کدام حساب پرداخت شد؟';
  const cat = inp.categoryId && d.categories.some((c) => c.id === inp.categoryId && c.kind === 'expense') ? inp.categoryId : null;
  const note = purchaseNote(items);
  const freqBefore = { ...(d.shoppingFreq ?? {}) };
  let receipt: PurchaseReceipt;

  if (inp.linkTxnId) {
    const t = d.txns.find((x) => x.id === inp.linkTxnId && x.kind === 'expense' && x.amountRial === amountRial);
    if (!t) return 'آن تراکنش بانک دیگر با همین مبلغ پیدا نشد.';
    receipt = { txnId: t.id, how: 'linked', before: { note: t.note, categoryId: t.categoryId }, items: items.map((x) => ({ ...x })), freq: freqBefore };
    t.note = [note, t.note].filter(Boolean).join(' — ').slice(0, 160);
    if (cat) t.categoryId = cat;
  } else if (inp.stagedId) {
    const s = d.inbox.find((x) => x.id === inp.stagedId);
    if (!s || s.amountRial !== amountRial) return 'آن پیامک بانک دیگر در صف نیست یا مبلغش فرق دارد.';
    const copy = { ...s };
    const before = new Set(d.txns.map((t) => t.id));
    const err = commitStaged(d, s.id, { choice: 'expense', accountId: inp.accountId, categoryId: cat, date: s.date ?? inp.date });
    if (err) return err;
    const t = d.txns.find((x) => !before.has(x.id))!;
    t.note = [note, t.note].filter(Boolean).join(' — ').slice(0, 160);
    receipt = { txnId: t.id, how: 'staged', staged: copy, items: items.map((x) => ({ ...x })), freq: freqBefore };
  } else {
    const t: Txn = { id: newId('t'), date: inp.date, kind: 'expense', amountRial, accountId: inp.accountId, categoryId: cat, note, addedAt: now };
    d.txns.push(t);
    receipt = { txnId: t.id, how: 'new', items: items.map((x) => ({ ...x })), freq: freqBefore };
  }

  d.shoppingFreq ??= {};
  for (const it of items) {
    it.txnId = receipt.txnId;
    d.shoppingFreq[it.name] = (d.shoppingFreq[it.name] ?? 0) + 1;
  }
  // booked items leave the list; the transaction keeps what they were
  d.shopping = (d.shopping ?? []).filter((x) => !x.txnId);
  return receipt;
}

/** «برگرداندن»: exactly what bookPurchase did, undone — the SMS back in the queue, the bank's row as it was. */
export function undoPurchase(d: FinanceData, r: PurchaseReceipt): void {
  const t = d.txns.find((x) => x.id === r.txnId);
  if (r.how === 'linked') {
    if (t) {
      t.note = r.before?.note;
      t.categoryId = r.before?.categoryId ?? null;
    }
  } else {
    d.txns = d.txns.filter((x) => x.id !== r.txnId);
    if (r.how === 'staged' && r.staged && !d.inbox.some((x) => x.id === r.staged!.id)) d.inbox.push(r.staged);
  }
  d.shopping ??= [];
  for (const it of r.items) if (!d.shopping.some((x) => x.id === it.id)) d.shopping.push({ ...it, txnId: null });
  d.shoppingFreq = { ...r.freq };
}
