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
  /**
   * The latest balance the bank itself stated (an SMS «مانده» or a statement's running balance).
   * Shown next to the book balance; it never changes the book by itself (see sources.ts).
   */
  reported?: { rial: number; date: Iso; time?: string | null; via: 'sms' | 'statement' } | null;
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
  /** where it came from; absent = typed in by hand */
  src?: 'statement' | 'sms' | 'classic';
  /** bank tracking / document number, when the statement or SMS had one */
  ref?: string | null;
  /** 'HH:MM' when the source gave it — orders same-day rows against a bank-stated balance */
  time?: string | null;
  /** SMS rows: which message it was (smsKeyOf) and when it arrived, so the same SMS — read from the
   *  inbox and also answered in the «نوعش چیست؟» notification — is never booked twice */
  smsKey?: string;
  smsAt?: number | null;
}

/**
 * A transaction read from a bank statement or an SMS, waiting for the user to confirm it.
 * `direction` is only set when the source states it (a debit/credit column, a sign, a change in
 * the running balance, or an explicit verb in the SMS). Otherwise it stays null and the user
 * decides — direction is never guessed (CLAUDE.md rule 3).
 */
export interface Staged {
  id: string;
  /** 'classic' = moved over from the earlier Android app's expenses */
  source: 'statement' | 'sms' | 'classic';
  /** null when the source carried no usable date — the user must pick one */
  date: Iso | null;
  time?: string | null;
  amountRial: number;
  direction: 'out' | 'in' | null;
  /** how the direction was established, shown to the user */
  why: string;
  balanceRial?: number | null;
  description: string;
  ref?: string | null;
  card?: string | null;
  /** account number the SMS named */
  accountNo?: string | null;
  /** bank name in the SMS, or the sender it came from */
  bank?: string | null;
  /** receive time (ms) when known — the phone inbox gives it */
  at?: number | null;
  fee?: boolean;
  /** the parser could only half-read the source: the user should check the amount */
  uncertainAmount?: boolean;
  /** a category already chosen at the source (the earlier app), pre-filled in the queue */
  categoryId?: string | null;
  /** the source marked it as money moved between the user's own accounts */
  transfer?: boolean;
  /** the original SMS text / statement row, for the user to check */
  raw: string;
  /** account the file or SMS belongs to, when known */
  accountId?: string | null;
  /** SMS: the message itself (smsKeyOf), the same whichever way it was read */
  smsKey?: string;
  importedAt: number;
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
  /** market only, optional: what was paid in total and when — shows the gain or loss */
  costRial?: number | null;
  boughtOn?: Iso | null;
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
  /** imported transactions not yet confirmed */
  inbox: Staged[];
  /** description key → category the user chose last time, so the next import pre-fills it */
  catMemory: Record<string, string>;
  /** cards and bank accounts seen in SMS, with the balance the bank last stated (sources.ts) */
  smsSources: SmsSource[];
}

/** A card or bank account that bank SMS mention — found automatically, linked to an account by the user. */
export interface SmsSource {
  /** 'card:4417' | 'acc:0123456789' */
  key: string;
  kind: 'card' | 'account';
  /** last four digits of the card, or the account number */
  ref: string;
  bank: string | null;
  accountId: string | null;
  ignored?: boolean;
  count: number;
  firstAt: number;
  lastAt: number;
  lastBalanceRial: number | null;
  lastBalanceAt: number | null;
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
    inbox: [],
    catMemory: {},
    smsSources: [],
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
    inbox: arr<Staged>(raw.inbox).filter((x) => x && typeof x.amountRial === 'number' && x.amountRial > 0),
    catMemory: isObj(raw.catMemory) ? (raw.catMemory as Record<string, string>) : {},
    smsSources: arr<SmsSource>(raw.smsSources).filter((x) => x && typeof x.key === 'string' && (x.kind === 'card' || x.kind === 'account')),
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
