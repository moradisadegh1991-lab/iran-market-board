// مدیریت دارایی واقعی — the user's actual holdings, valued against live prices.
// Nothing here trades or advises: it stores what was bought (quantity + total price paid + date)
// and marks it to market. One shared list per deployment, guarded by ADMIN_SECRET on writes.
import { kv } from '@/lib/store';
import { isNum, tehranDate } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchBrsGoldCurrency, brsPriceBook, type BrsMarketItem } from '@/lib/sources/brsapi';
import { getSnapshot } from '@/lib/snapshot';

const KEY = 'holdings:v1';
const MAX_ITEMS = 200;

export type HoldingKind = 'gold' | 'coin' | 'currency' | 'crypto';

export const KIND_LABEL: Record<HoldingKind, string> = { gold: 'طلا', coin: 'سکه', currency: 'ارز', crypto: 'ارز دیجیتال' };
export const KIND_QTY_LABEL: Record<HoldingKind, string> = { gold: 'مقدار (گرم)', coin: 'مقدار (تعداد)', currency: 'مقدار (تعداد)', crypto: 'مقدار (تعداد)' };

/**
 * The instrument menu. `brs` is the symbol in the BrsApi Gold_Currency feed; `fallback` is a
 * snapshot key used when that feed is unavailable. Instruments whose price we cannot source at
 * all are deliberately absent — a holding we cannot value honestly should not be offerable.
 */
export interface Instrument {
  key: string;
  kind: HoldingKind;
  label: string;
  unit: string;
  brs?: string;
  fallback?: 'usd' | 'usdt' | 'g18' | 'coin' | 'btc' | 'eth';
  /** crypto only: CoinGecko id, priced in USD from the snapshot screener */
  cg?: string;
  step: number;
}

export const INSTRUMENTS: Instrument[] = [
  { key: 'g18', kind: 'gold', label: 'طلای ۱۸ عیار (گرم)', unit: 'گرم', brs: 'IR_GOLD_18K', fallback: 'g18', step: 0.01 },
  { key: 'g24', kind: 'gold', label: 'طلای ۲۴ عیار (گرم)', unit: 'گرم', brs: 'IR_GOLD_24K', step: 0.01 },
  { key: 'gmelted', kind: 'gold', label: 'طلای آب‌شده (گرم)', unit: 'گرم', brs: 'IR_GOLD_MELTED', step: 0.01 },
  { key: 'coin_emami', kind: 'coin', label: 'سکه امامی', unit: 'سکه', brs: 'IR_COIN_EMAMI', fallback: 'coin', step: 0.1 },
  { key: 'coin_bahar', kind: 'coin', label: 'سکه بهار آزادی', unit: 'سکه', brs: 'IR_COIN_BAHAR', step: 0.1 },
  { key: 'coin_half', kind: 'coin', label: 'نیم‌سکه', unit: 'نیم‌سکه', brs: 'IR_COIN_HALF', step: 1 },
  { key: 'coin_quarter', kind: 'coin', label: 'ربع‌سکه', unit: 'ربع‌سکه', brs: 'IR_COIN_QUARTER', step: 1 },
  { key: 'coin_gram', kind: 'coin', label: 'سکه گرمی', unit: 'سکه', brs: 'IR_COIN_1G', step: 1 },
  { key: 'usd', kind: 'currency', label: 'دلار آمریکا', unit: 'دلار', brs: 'USD', fallback: 'usd', step: 1 },
  { key: 'eur', kind: 'currency', label: 'یورو', unit: 'یورو', brs: 'EUR', step: 1 },
  { key: 'aed', kind: 'currency', label: 'درهم امارات', unit: 'درهم', brs: 'AED', step: 1 },
  { key: 'gbp', kind: 'currency', label: 'پوند انگلیس', unit: 'پوند', brs: 'GBP', step: 1 },
  { key: 'try', kind: 'currency', label: 'لیر ترکیه', unit: 'لیر', brs: 'TRY', step: 1 },
  { key: 'usdt', kind: 'crypto', label: 'تتر (USDT)', unit: 'تتر', fallback: 'usdt', step: 0.01 },
  { key: 'btc', kind: 'crypto', label: 'بیت‌کوین (BTC)', unit: 'BTC', cg: 'bitcoin', fallback: 'btc', step: 0.00001 },
  { key: 'eth', kind: 'crypto', label: 'اتریوم (ETH)', unit: 'ETH', cg: 'ethereum', fallback: 'eth', step: 0.0001 },
  { key: 'sol', kind: 'crypto', label: 'سولانا (SOL)', unit: 'SOL', cg: 'solana', step: 0.001 },
  { key: 'xrp', kind: 'crypto', label: 'ریپل (XRP)', unit: 'XRP', cg: 'ripple', step: 0.1 },
  { key: 'doge', kind: 'crypto', label: 'دوج‌کوین (DOGE)', unit: 'DOGE', cg: 'dogecoin', step: 1 },
  { key: 'ton', kind: 'crypto', label: 'تون‌کوین (TON)', unit: 'TON', cg: 'the-open-network', step: 0.01 },
];

export const INSTRUMENT = Object.fromEntries(INSTRUMENTS.map((i) => [i.key, i])) as Record<string, Instrument>;

export interface Holding {
  id: string;
  kind: HoldingKind;
  instrument: string;
  qty: number;
  /** total toman actually paid for this lot, as entered by the user */
  paidToman: number;
  boughtOn: string | null; // YYYY-MM-DD (Gregorian)
  note: string | null;
  addedAt: number;
}

export interface ValuedHolding extends Holding {
  label: string;
  unit: string;
  unitPriceToman: number | null; // current price per unit
  valueToman: number | null; // qty × unit price
  pnlToman: number | null;
  pnlPct: number | null;
  buyUnitPriceToman: number | null; // what they effectively paid per unit
  priceSource: 'brsapi' | 'snapshot' | 'coingecko' | null;
  priceNote: string | null;
}

export interface HoldingsSummary {
  items: ValuedHolding[];
  totalValueToman: number;
  totalPaidToman: number;
  pnlToman: number;
  pnlPct: number | null;
  /** value per kind, for the breakdown bar */
  byKind: { kind: HoldingKind; label: string; valueToman: number; share: number }[];
  unvalued: number; // holdings we could not price
  priceAt: string; // snapshot generatedAt (ISO)
  warnings: string[];
}

// ── storage ──────────────────────────────────────────────────────────────────

export async function listHoldings(): Promise<Holding[]> {
  const raw = (await kv.get<Holding[]>(KEY)) ?? [];
  return Array.isArray(raw) ? raw : [];
}

const save = (h: Holding[]) => kv.set(KEY, h);

export function validateHolding(body: any): Omit<Holding, 'id' | 'addedAt'> {
  const instrument = String(body?.instrument ?? '');
  const inst = INSTRUMENT[instrument];
  if (!inst) throw new Error('نوع دارایی انتخاب‌شده معتبر نیست.');
  const qty = Number(body?.qty);
  if (!isNum(qty) || qty <= 0 || qty > 1e12) throw new Error('مقدار باید عددی بزرگ‌تر از صفر باشد.');
  const paidToman = Math.round(Number(body?.paidToman));
  if (!isNum(paidToman) || paidToman < 0 || paidToman > 1e15) throw new Error('مبلغ کل خرید معتبر نیست.');
  const boughtOnRaw = String(body?.boughtOn ?? '').trim();
  let boughtOn: string | null = null;
  if (boughtOnRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(boughtOnRaw) || Number.isNaN(Date.parse(`${boughtOnRaw}T00:00:00Z`))) throw new Error('تاریخ خرید باید به شکل YYYY-MM-DD باشد.');
    if (boughtOnRaw > tehranDate(new Date())) throw new Error('تاریخ خرید نمی‌تواند در آینده باشد.');
    boughtOn = boughtOnRaw;
  }
  const noteRaw = String(body?.note ?? '').trim();
  return { kind: inst.kind, instrument, qty, paidToman, boughtOn, note: noteRaw ? noteRaw.slice(0, 200) : null };
}

export async function addHolding(body: any): Promise<Holding> {
  const list = await listHoldings();
  if (list.length >= MAX_ITEMS) throw new Error(`حداکثر ${MAX_ITEMS.toLocaleString('fa-IR')} قلم دارایی قابل ثبت است.`);
  const h: Holding = { ...validateHolding(body), id: Math.random().toString(36).slice(2, 10), addedAt: Date.now() };
  await save([h, ...list]);
  return h;
}

export async function removeHolding(id: string): Promise<void> {
  const list = await listHoldings();
  const next = list.filter((h) => h.id !== id);
  if (next.length === list.length) throw new Error('این قلم دارایی پیدا نشد.');
  await save(next);
}

// ── valuation ────────────────────────────────────────────────────────────────

/** Converts a feed price to toman using its reported unit. Rial is 1/10 toman. */
function toToman(item: BrsMarketItem): number | null {
  const u = (item.unit ?? '').trim();
  if (!u || /تومان/.test(u)) return item.price;
  if (/ریال/.test(u)) return item.price / 10;
  return null; // dollar-quoted (or unknown) — handled by the crypto path instead
}

export async function valueHoldings(): Promise<HoldingsSummary> {
  const [list, snap, gc] = await Promise.all([
    listHoldings(),
    getSnapshot(),
    cachedSource('brsGoldCurrency', 120, fetchBrsGoldCurrency, 4 * 24 * 3600).catch(() => null),
  ]);
  const warnings: string[] = [];
  const book = gc?.data ? brsPriceBook(gc.data) : {};
  if (!gc?.status.ok && !gc?.data) warnings.push('فید طلا و ارز BrsApi در دسترس نبود؛ قیمت اقلامی که منبع جانشین ندارند محاسبه نشد.');

  const snapToman = (k: string) => snap.live.items.find((i) => i.key === k)?.price ?? null;
  const usdtToman = snapToman('usdt');
  const cgPrice = (id: string) => [...snap.crypto.coins, ...snap.crypto.memes].find((c) => c.id === id)?.price ?? null;

  const priceOf = (inst: Instrument): { price: number | null; source: ValuedHolding['priceSource']; note: string | null } => {
    // 1) the rial/toman feed, when it carries this symbol in a unit we understand
    if (inst.brs && book[inst.brs]) {
      const t = toToman(book[inst.brs]);
      if (isNum(t) && t > 0) return { price: t, source: 'brsapi', note: null };
    }
    // 2) the dashboard's own live board
    if (inst.fallback) {
      const p = snapToman(inst.fallback);
      if (isNum(p) && p > 0) return { price: p, source: 'snapshot', note: inst.brs && !book[inst.brs] ? 'از تابلوی خود داشبورد' : null };
    }
    // 3) dollar-priced crypto × tether
    if (inst.cg && isNum(usdtToman)) {
      const usd = cgPrice(inst.cg);
      if (isNum(usd) && usd > 0) return { price: usd * usdtToman, source: 'coingecko', note: 'قیمت دلاری × نرخ تتر' };
    }
    return { price: null, source: null, note: 'قیمت لحظه‌ای این دارایی در دسترس نبود' };
  };

  const items: ValuedHolding[] = list.map((h) => {
    const inst = INSTRUMENT[h.instrument];
    const label = inst?.label ?? h.instrument;
    const unit = inst?.unit ?? '';
    if (!inst) return { ...h, label, unit, unitPriceToman: null, valueToman: null, pnlToman: null, pnlPct: null, buyUnitPriceToman: null, priceSource: null, priceNote: 'این نوع دارایی دیگر پشتیبانی نمی‌شود' };
    const { price, source, note } = priceOf(inst);
    const value = isNum(price) ? price * h.qty : null;
    const pnl = isNum(value) ? value - h.paidToman : null;
    return {
      ...h,
      label,
      unit,
      unitPriceToman: price,
      valueToman: value,
      pnlToman: pnl,
      pnlPct: isNum(pnl) && h.paidToman > 0 ? (pnl / h.paidToman) * 100 : null,
      buyUnitPriceToman: h.qty > 0 ? h.paidToman / h.qty : null,
      priceSource: source,
      priceNote: note,
    };
  });

  const priced = items.filter((i) => isNum(i.valueToman));
  const totalValueToman = priced.reduce((a, i) => a + i.valueToman!, 0);
  const totalPaidToman = priced.reduce((a, i) => a + i.paidToman, 0);
  const unvalued = items.length - priced.length;
  if (unvalued > 0) warnings.push(`${unvalued.toLocaleString('fa-IR')} قلم قابل قیمت‌گذاری نبود و در جمع کل و سود حساب نشده است.`);

  const kinds: HoldingKind[] = ['gold', 'coin', 'currency', 'crypto'];
  const byKind = kinds
    .map((kind) => {
      const v = priced.filter((i) => i.kind === kind).reduce((a, i) => a + i.valueToman!, 0);
      return { kind, label: KIND_LABEL[kind], valueToman: v, share: totalValueToman > 0 ? v / totalValueToman : 0 };
    })
    .filter((k) => k.valueToman > 0);

  return {
    items,
    totalValueToman,
    totalPaidToman,
    pnlToman: totalValueToman - totalPaidToman,
    pnlPct: totalPaidToman > 0 ? ((totalValueToman - totalPaidToman) / totalPaidToman) * 100 : null,
    byKind,
    unvalued,
    priceAt: snap.generatedAt,
    warnings,
  };
}
