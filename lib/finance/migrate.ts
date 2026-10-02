// Moving the earlier Android app's data into the one book. That app kept expenses, pending SMS
// and holdings under its own keys on the same device; the unified app reads them once, on the
// user's request, and never deletes them (the user can always look again or redo it).
//
// Expenses do not go straight into the book: they go to the import queue with the direction and
// category the user had already given them, so one tap books them — and an entry the old app
// could not place (direction unknown, half-read SMS) is still asked about (rule 3).
import type { Asset, FinanceData, Iso, MarketKey, Staged } from './model';
import { learnSources } from './sources';

export const CLASSIC_KEYS = {
  tx: 'imb.tx.v1',
  pending: 'imb.pending.v1',
  cats: 'imb.cats.v1',
  inCats: 'imb.incats.v1',
  holdings: 'imb.holdings.v1',
} as const;
export const MIGRATED_KEY = 'imf.classic.migrated.v1';

export interface ClassicTx {
  id: string;
  at: number;
  amount: number; // rial
  out: boolean;
  typeUnknown?: boolean;
  transfer?: boolean;
  fee?: boolean;
  cat?: string | null;
  card?: string | null;
  accountNo?: string | null;
  bank?: string | null;
  balance?: number | null;
  channel?: string | null;
  raw?: string;
  note?: string;
}
export interface ClassicPending {
  id: string;
  at: number;
  body: string;
  amount: number | null;
}
export interface ClassicHolding {
  instrument: string;
  qty: number;
  paid?: number; // toman, total
  boughtOn?: string;
  at?: number;
}
export interface ClassicCat {
  id: string;
  name: string;
}
export interface ClassicData {
  tx: ClassicTx[];
  pending: ClassicPending[];
  holdings: ClassicHolding[];
  cats: ClassicCat[];
  inCats: ClassicCat[];
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Whatever was under the old keys, shape-checked. */
export function parseClassic(get: (k: string) => string | null): ClassicData {
  const j = (k: string) => {
    try {
      return JSON.parse(get(k) ?? 'null');
    } catch {
      return null;
    }
  };
  return {
    tx: arr<ClassicTx>(j(CLASSIC_KEYS.tx)).filter((t) => t && fin(t.amount) && t.amount > 0 && fin(t.at)),
    pending: arr<ClassicPending>(j(CLASSIC_KEYS.pending)).filter((p) => p && fin(p.at) && typeof p.body === 'string'),
    holdings: arr<ClassicHolding>(j(CLASSIC_KEYS.holdings)).filter((h) => h && typeof h.instrument === 'string' && fin(h.qty) && h.qty > 0),
    cats: arr<ClassicCat>(j(CLASSIC_KEYS.cats)),
    inCats: arr<ClassicCat>(j(CLASSIC_KEYS.inCats)),
  };
}

export const classicCount = (c: ClassicData) => c.tx.length + c.pending.length + c.holdings.length;

// the old app's category names → this book's categories
const CAT_BY_NAME: Record<string, string> = {
  خوراک: 'c-food', 'حمل‌ونقل': 'c-transport', قبوض: 'c-bills', خرید: 'c-shop', درمان: 'c-health', مسکن: 'c-home', آموزش: 'c-edu', سایر: 'c-other',
};
const INCAT_BY_NAME: Record<string, string> = {
  حقوق: 'i-salary', پروژه: 'i-freelance', فروش: 'i-other', 'سود سرمایه': 'i-invest', هدیه: 'i-other', سایر: 'i-other',
};
const MARKET: MarketKey[] = ['usd', 'usdt', 'coin', 'nim', 'rob', 'g18', 'silver', 'btc', 'eth'];
const LABEL: Record<string, string> = { g18: 'طلای ۱۸ عیار', coin: 'سکه امامی', usd: 'دلار', usdt: 'تتر', btc: 'بیت‌کوین', eth: 'اتریوم', nim: 'نیم‌سکه', rob: 'ربع‌سکه', silver: 'نقره ۹۹۹' };

const tehranIso = (ms: number): Iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const tehranTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

export interface MigrateResult {
  queued: number;
  assets: number;
}

/**
 * Queues the old expenses (with their direction and category) and adds the old holdings as
 * market assets with their purchase cost. Idempotent: ids are derived from the old ids, so a
 * second run adds nothing.
 */
export function migrateClassic(d: FinanceData, c: ClassicData, accountId: string | null, now: number): MigrateResult {
  const catName = new Map([...c.cats, ...c.inCats].map((x) => [x.id, x.name]));
  const have = new Set(d.inbox.map((x) => x.id));
  const booked = new Set(d.txns.map((t) => t.ref).filter(Boolean));
  const fresh: Staged[] = [];
  const push = (s: Staged) => {
    // a row already booked from an earlier run carries the old id in its ref
    if (have.has(s.id) || booked.has(s.ref ?? '')) return;
    have.add(s.id);
    fresh.push(s);
  };

  for (const t of c.tx) {
    const dir = t.typeUnknown ? null : t.out ? 'out' : 'in';
    const name = t.cat ? catName.get(t.cat) : undefined;
    const cat = name ? (dir === 'in' ? INCAT_BY_NAME[name] : CAT_BY_NAME[name]) ?? null : t.fee ? 'c-other' : null;
    push({
      id: `classic-${t.id}`,
      source: 'classic',
      date: tehranIso(t.at),
      time: tehranTime(t.at),
      amountRial: Math.round(t.amount),
      direction: dir,
      why: dir ? 'منتقل‌شده از نسخه قبلی اپ (جهت را آن‌جا تأیید کرده بودید)' : 'در نسخه قبلی هم جهتش نامعلوم بود — خودتان تعیین کنید',
      balanceRial: fin(t.balance) ? t.balance : null,
      description: t.note?.trim() || [t.channel, t.card ? `کارت ${t.card}` : null, t.accountNo ? `حساب ${t.accountNo}` : null, t.bank].filter(Boolean).join(' · ') || 'تراکنش نسخه قبلی',
      ref: `classic:${t.id}`,
      card: t.card ?? null,
      accountNo: t.accountNo ?? null,
      bank: t.bank ?? null,
      at: t.at,
      fee: !!t.fee,
      transfer: !!t.transfer,
      categoryId: cat,
      raw: t.raw ?? '',
      accountId,
      importedAt: now,
    });
  }
  for (const p of c.pending) {
    if (!fin(p.amount) || p.amount <= 0) continue;
    push({
      id: `classic-p-${p.id}`,
      source: 'classic',
      date: tehranIso(p.at),
      time: tehranTime(p.at),
      amountRial: Math.round(p.amount),
      direction: null,
      uncertainAmount: true,
      why: 'پیامکی که نسخه قبلی کامل نخوانده بود؛ مبلغ و جهت را بررسی کنید',
      description: p.body.replace(/\s+/g, ' ').slice(0, 80),
      ref: `classic:p-${p.id}`,
      raw: p.body,
      accountId,
      importedAt: now,
    });
  }

  // the old app's cards and accounts (and their last stated balance) become detected sources
  learnSources(d, fresh, now);
  d.inbox.push(...fresh);
  const queued = fresh.length;

  let assets = 0;
  const assetIds = new Set(d.assets.map((a) => a.id));
  c.holdings.forEach((h, i) => {
    if (!MARKET.includes(h.instrument as MarketKey)) return;
    const id = `a-classic-${h.instrument}-${h.at ?? i}`;
    if (assetIds.has(id)) return;
    const a: Asset = {
      id,
      name: LABEL[h.instrument] ?? h.instrument,
      kind: 'market',
      key: h.instrument as MarketKey,
      qty: h.qty,
      costRial: fin(h.paid) && h.paid > 0 ? Math.round(h.paid * 10) : null,
      boughtOn: h.boughtOn && /^\d{4}-\d{2}-\d{2}$/.test(h.boughtOn) ? h.boughtOn : null,
    };
    d.assets.push(a);
    assetIds.add(id);
    assets++;
  });
  return { queued, assets };
}

