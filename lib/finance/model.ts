// مالی شخصی — data model.
//
// Everything here lives in the user's own browser (localStorage), never on the server: the same
// rule the Android app follows for holdings and expenses (CLAUDE.md §4 rule 7). The one exception
// is the advisor, which receives a numbers-only summary the user can read before sending.
//
// Every amount is stored in RIAL (rule 1). Conversion to toman happens only for display, and the
// form fields that take toman multiply by 10 exactly once, at the boundary (see `tomanToRial`).

export type Iso = string; // 'YYYY-MM-DD', Gregorian, Tehran calendar day

export type AccountKind = 'bank' | 'cash' | 'wallet' | 'fund';
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  bank: 'حساب بانکی',
  cash: 'نقد',
  wallet: 'کیف پول',
  fund: 'صندوق درآمد ثابت',
};

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** balance on `openedOn`; later balances are derived from transactions */
  openingRial: number;
  openedOn: Iso;
  archived?: boolean;
}

export type CategoryKind = 'expense' | 'income';
export interface Category {
  id: string;
  name: string;
  emoji: string;
  kind: CategoryKind;
}

export type TxnKind = 'expense' | 'income' | 'transfer';
export interface Txn {
  id: string;
  date: Iso;
  kind: TxnKind;
  amountRial: number; // always positive; direction comes from `kind`
  accountId: string;
  /** transfer only: destination account */
  toAccountId?: string | null;
  categoryId?: string | null;
  note?: string;
  /** set when the transaction was created by paying a loan installment / bill / cheque */
  link?: { type: 'loan' | 'bill' | 'cheque'; id: string; n?: number } | null;
}

export interface Budget {
  categoryId: string;
  monthlyRial: number;
}

/** A bank loan, an installment purchase, or a personal debt. `lent` means someone owes the user. */
export interface Loan {
  id: string;
  name: string;
  direction: 'borrowed' | 'lent';
  principalRial: number;
  /** nominal annual rate in percent (Iranian banks quote e.g. 23) */
  annualRatePct: number;
  months: number;
  firstDueDate: Iso;
  /** how many installments are already settled, in order */
  paidCount: number;
}

export type ChequeStatus = 'pending' | 'cleared' | 'bounced';
export interface Cheque {
  id: string;
  direction: 'issued' | 'received';
  amountRial: number;
  dueDate: Iso;
  /** kept on the device only — never included in the advisor summary */
  counterparty: string;
  status: ChequeStatus;
}

/** A monthly obligation: rent, شارژ, insurance, subscription, school fee… */
export interface Bill {
  id: string;
  name: string;
  amountRial: number;
  /** Jalali day of month it is due (1–31; clamped to the month's length) */
  dueDay: number;
  categoryId: string | null;
  /** Jalali months already paid, as 'jy-jm' */
  paidMonths: string[];
  active: boolean;
}

export interface Goal {
  id: string;
  name: string;
  /** in today's money when `inflationAdjust` is on */
  targetRial: number;
  targetDate: Iso;
  savedRial: number;
  inflationAdjust: boolean;
}

/** Market-priced keys come straight from the snapshot board (`snap.live.items`). */
export type MarketKey = 'usd' | 'usdt' | 'coin' | 'nim' | 'rob' | 'g18' | 'silver' | 'btc' | 'eth';
export const MARKET_ASSETS: { key: MarketKey; label: string; unit: string; step: number }[] = [
  { key: 'g18', label: 'طلای ۱۸ عیار', unit: 'گرم', step: 0.01 },
  { key: 'coin', label: 'سکه امامی', unit: 'عدد', step: 1 },
  { key: 'nim', label: 'نیم‌سکه', unit: 'عدد', step: 1 },
  { key: 'rob', label: 'ربع‌سکه', unit: 'عدد', step: 1 },
  { key: 'silver', label: 'نقره ۹۹۹', unit: 'گرم', step: 0.1 },
  { key: 'usd', label: 'دلار', unit: 'دلار', step: 1 },
  { key: 'usdt', label: 'تتر', unit: 'تتر', step: 0.01 },
  { key: 'btc', label: 'بیت‌کوین', unit: 'BTC', step: 0.00001 },
  { key: 'eth', label: 'اتریوم', unit: 'ETH', step: 0.0001 },
];

export interface Asset {
  id: string;
  name: string;
  kind: 'market' | 'manual';
  /** market only */
  key?: MarketKey;
  qty?: number;
  /** manual only (house, car, stock portfolio, رهن deposit…) */
  valueRial?: number;
  /** manual only: does it count as liquid (sellable within a week)? */
  liquid?: boolean;
}

export interface Settings {
  /** expected annual inflation, percent — drives goal planning and real-return figures */
  inflationPct: number;
  /** what a fixed-income fund pays, percent per year — the hurdle any other choice must beat */
  safeYieldPct: number;
  /** months of expenses the emergency fund should cover */
  emergencyMonths: number;
}

export interface FinanceData {
  version: 1;
  accounts: Account[];
  categories: Category[];
  txns: Txn[];
  budgets: Budget[];
  loans: Loan[];
  cheques: Cheque[];
  bills: Bill[];
  goals: Goal[];
  assets: Asset[];
  settings: Settings;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'c-food', name: 'خوراک', emoji: '🍽', kind: 'expense' },
  { id: 'c-home', name: 'مسکن و اجاره', emoji: '🏠', kind: 'expense' },
  { id: 'c-bills', name: 'قبوض و شارژ', emoji: '🧾', kind: 'expense' },
  { id: 'c-transport', name: 'حمل‌ونقل', emoji: '🚗', kind: 'expense' },
  { id: 'c-health', name: 'درمان', emoji: '💊', kind: 'expense' },
  { id: 'c-edu', name: 'آموزش', emoji: '📚', kind: 'expense' },
  { id: 'c-shop', name: 'خرید', emoji: '🛍', kind: 'expense' },
  { id: 'c-fun', name: 'تفریح', emoji: '🎬', kind: 'expense' },
  { id: 'c-loan', name: 'اقساط و بدهی', emoji: '🏦', kind: 'expense' },
  { id: 'c-gift', name: 'هدیه و کمک', emoji: '🎁', kind: 'expense' },
  { id: 'c-other', name: 'سایر هزینه‌ها', emoji: '💰', kind: 'expense' },
  { id: 'i-salary', name: 'حقوق', emoji: '💼', kind: 'income' },
  { id: 'i-freelance', name: 'پروژه و کار آزاد', emoji: '🧑‍💻', kind: 'income' },
  { id: 'i-invest', name: 'سود سرمایه‌گذاری', emoji: '📈', kind: 'income' },
  { id: 'i-rent', name: 'اجاره دریافتی', emoji: '🏘', kind: 'income' },
  { id: 'i-loanback', name: 'بازپرداخت طلب', emoji: '🤝', kind: 'income' },
  { id: 'i-other', name: 'سایر درآمدها', emoji: '💵', kind: 'income' },
];

export const DEFAULT_SETTINGS: Settings = { inflationPct: 40, safeYieldPct: 30, emergencyMonths: 6 };

export function emptyData(today: Iso): FinanceData {
  return {
    version: 1,
    accounts: [{ id: 'a-cash', name: 'کیف پول نقد', kind: 'cash', openingRial: 0, openedOn: today }],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    txns: [],
    budgets: [],
    loans: [],
    cheques: [],
    bills: [],
    goals: [],
    assets: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const finite = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/**
 * Accepts whatever came out of localStorage or a backup file and returns a well-formed document.
 * Throws on something that is clearly not a backup of this app, so an import never silently
 * replaces real data with an empty book.
 */
export function normalizeData(raw: unknown, today: Iso): FinanceData {
  if (!isObj(raw) || raw.version !== 1) throw new Error('این فایل پشتیبان «مالی من» نیست (نسخه نامعتبر).');
  const base = emptyData(today);
  const s = isObj(raw.settings) ? raw.settings : {};
  return {
    version: 1,
    accounts: arr<Account>(raw.accounts),
    categories: arr<Category>(raw.categories).length ? arr<Category>(raw.categories) : base.categories,
    txns: arr<Txn>(raw.txns).filter((t) => t && typeof t.amountRial === 'number' && t.amountRial > 0),
    budgets: arr<Budget>(raw.budgets),
    loans: arr<Loan>(raw.loans),
    cheques: arr<Cheque>(raw.cheques),
    bills: arr<Bill>(raw.bills).map((b) => ({ ...b, paidMonths: arr<string>(b.paidMonths) })),
    goals: arr<Goal>(raw.goals),
    assets: arr<Asset>(raw.assets),
    settings: {
      inflationPct: finite(s.inflationPct, DEFAULT_SETTINGS.inflationPct),
      safeYieldPct: finite(s.safeYieldPct, DEFAULT_SETTINGS.safeYieldPct),
      emergencyMonths: finite(s.emergencyMonths, DEFAULT_SETTINGS.emergencyMonths),
    },
  };
}

export const tomanToRial = (t: number) => Math.round(t * 10);
export const rialToTomanN = (r: number) => r / 10;

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
