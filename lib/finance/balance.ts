// An account's balance, from what the bank says (CLAUDE.md rule 76).
//
// A card's or bank account's balance is the latest balance the bank stated (the «مانده» of an SMS, a
// statement's running balance, or what the user typed as «موجودی الان») plus whatever was booked after
// that moment. Before this, the book was opening + every transaction and the bank's number was only
// shown beside it; one missed SMS and the book was wrong for good.
//
// The book is still kept, because it is what can disagree: month-start balance + this month's booked
// transactions (and the rows still waiting in the queue) should equal the bank's latest balance. When it
// does not, the app does not guess why — it asks (monthCheck → the three answers below).
import { isoToJalali, jalaliToIso } from '../jalali';
import { newId, type Account, type FinanceData, type Iso, type Reported, type Txn } from './model';

const TEHRAN = '+03:30'; // Iran has had no DST since 2022
const LOG_MAX = 120;

/** ms of a stated balance (Tehran time; no time = the end of that day). */
export function reportedAt(r: Pick<Reported, 'date' | 'time'>): number {
  const t = /^\d{1,2}:\d{2}$/.test(r.time ?? '') ? r.time!.padStart(5, '0') : '23:59';
  return Date.parse(`${r.date}T${t}:00${TEHRAN}`);
}

/**
 * Was this transaction already in the bank's balance at that moment? By date; on the same day by time;
 * a same-day row without a time by when it was booked (addedAt), and an old row without either counts
 * as before — the way the bank's day closes.
 */
export function bookedBy(t: Pick<Txn, 'date' | 'time' | 'addedAt'>, r: Pick<Reported, 'date' | 'time'>): boolean {
  if (t.date !== r.date) return t.date < r.date;
  if (t.time && r.time) return t.time.padStart(5, '0') <= r.time.padStart(5, '0');
  if (typeof t.addedAt === 'number' && r.time) return t.addedAt <= reportedAt(r);
  return true;
}

/** What a transaction does to one account (+ in, − out, 0 not this account). */
export function effectOn(t: Txn, accountId: string): number {
  if (t.kind === 'income') return t.accountId === accountId ? t.amountRial : 0;
  if (t.kind === 'expense') return t.accountId === accountId ? -t.amountRial : 0;
  let x = 0;
  if (t.accountId === accountId) x -= t.amountRial;
  if (t.toAccountId === accountId) x += t.amountRial;
  return x;
}

/** opening + every transaction: what the book alone says. */
export function bookBalances(d: FinanceData): Record<string, number> {
  const bal: Record<string, number> = {};
  for (const a of d.accounts) bal[a.id] = a.openingRial;
  for (const t of d.txns) {
    if (t.accountId in bal) bal[t.accountId] += effectOn(t, t.accountId);
    if (t.kind === 'transfer' && t.toAccountId && t.toAccountId !== t.accountId && t.toAccountId in bal) bal[t.toAccountId] += t.amountRial;
  }
  return bal;
}

/** The balance shown everywhere: the bank's latest stated balance + what was booked after it; no statement → the book. */
export function balanceOf(d: FinanceData, a: Account, book?: number): number {
  const R = a.reported;
  if (!R) return book ?? bookBalances(d)[a.id] ?? a.openingRial;
  let x = R.rial;
  for (const t of d.txns) {
    const e = effectOn(t, a.id);
    if (e && !bookedBy(t, R)) x += e;
  }
  return x;
}

export function balances(d: FinanceData): Record<string, number> {
  const book = bookBalances(d);
  const out: Record<string, number> = {};
  for (const a of d.accounts) out[a.id] = a.reported ? balanceOf(d, a) : book[a.id];
  return out;
}

/** Keeps the bank's newest statement on the account, and every statement in its log. */
export function addReported(a: Account, r: Reported) {
  const at = reportedAt(r);
  const log = (a.reportedLog ??= []);
  if (!log.some((x) => reportedAt(x) === at && x.rial === r.rial)) {
    log.push(r);
    log.sort((p, q) => reportedAt(p) - reportedAt(q));
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  }
  if (!a.reported || reportedAt(a.reported) <= at) a.reported = r;
}

const tehranIso = (ms: number): Iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const tehranTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** «موجودی الان» typed by the user: the same as a statement from the bank, at this moment. */
export function setCurrentBalance(d: FinanceData, accountId: string, rial: number, now: number) {
  const a = d.accounts.find((x) => x.id === accountId);
  if (!a || !Number.isFinite(rial)) return;
  addReported(a, { rial: Math.round(rial), date: tehranIso(now), time: tehranTime(now), via: 'manual' });
  a.balanceOk = null;
}

/** First day of the Jalali month the date is in. */
export function monthStartOf(iso: Iso): Iso {
  const j = isoToJalali(iso);
  return jalaliToIso(j.jy, j.jm, 1);
}

export interface BalanceCheck {
  accountId: string;
  /** first day of the month checked (the month of the bank's latest balance) */
  monthStart: Iso;
  /** the balance at the start of that month — from the bank when it stated one before, else from the opening balance */
  startRial: number;
  startFrom: 'bank' | 'opening';
  /** the account was opened in the app during that month: its opening balance is the start */
  openedInMonth: boolean;
  /** booked this month up to the bank's moment, net */
  bookedRial: number;
  bookedCount: number;
  /** rows waiting in the queue for this account up to that moment, net (only those whose direction is known) */
  pendingRial: number;
  pendingCount: number;
  /** queued rows whose direction is unknown — the user must say before the books can agree */
  pendingUnknown: number;
  expectedRial: number;
  reportedRial: number;
  reported: Reported;
  /** bank − expected: > 0 money came in that the app does not know about, < 0 money went out */
  diffRial: number;
  /** the key «نادیده بگیر» stores */
  key: string;
}

const checkKey = (R: Reported) => `${R.date} ${R.time ?? ''} ${R.rial}`;

/**
 * Month-start balance + this month's transactions vs the bank's latest balance. null when the account
 * has no statement from the bank. `diffRial` 0 = they agree.
 */
export function monthCheck(d: FinanceData, accountId: string): BalanceCheck | null {
  const a = d.accounts.find((x) => x.id === accountId);
  const R = a?.reported;
  if (!a || !R) return null;
  const monthStart = monthStartOf(R.date);
  const beforeMonth = (t: Pick<Txn, 'date'>) => t.date < monthStart;
  // the bank's last word before the month began, if any
  const prior = [...(a.reportedLog ?? [])].filter((x) => x.date < monthStart).pop() ?? null;
  let startRial: number;
  let startFrom: BalanceCheck['startFrom'];
  if (prior) {
    startRial = prior.rial;
    for (const t of d.txns) {
      const e = effectOn(t, a.id);
      if (e && beforeMonth(t) && !bookedBy(t, prior)) startRial += e;
    }
    startFrom = 'bank';
  } else {
    startRial = a.openingRial;
    for (const t of d.txns) {
      const e = effectOn(t, a.id);
      if (e && beforeMonth(t)) startRial += e;
    }
    startFrom = 'opening';
  }
  let bookedRial = 0;
  let bookedCount = 0;
  for (const t of d.txns) {
    const e = effectOn(t, a.id);
    if (!e || beforeMonth(t) || !bookedBy(t, R)) continue;
    bookedRial += e;
    bookedCount++;
  }
  let pendingRial = 0;
  let pendingCount = 0;
  let pendingUnknown = 0;
  for (const r of d.inbox) {
    if (r.accountId !== a.id || !r.date || r.date < monthStart || !bookedBy({ date: r.date, time: r.time ?? null }, R)) continue;
    pendingCount++;
    if (r.direction === 'in') pendingRial += r.amountRial;
    else if (r.direction === 'out') pendingRial -= r.amountRial;
    else pendingUnknown++;
  }
  const expectedRial = startRial + bookedRial + pendingRial;
  return {
    accountId,
    monthStart,
    startRial,
    startFrom,
    openedInMonth: startFrom === 'opening' && a.openedOn >= monthStart,
    bookedRial,
    bookedCount,
    pendingRial,
    pendingCount,
    pendingUnknown,
    expectedRial,
    reportedRial: R.rial,
    reported: R,
    diffRial: R.rial - expectedRial,
    key: checkKey(R),
  };
}

/** The mismatches to ask the user about now: not agreeing, not waiting on the queue's unknown rows, not set aside. */
export function openChecks(d: FinanceData): BalanceCheck[] {
  const out: BalanceCheck[] = [];
  for (const a of d.accounts) {
    if (a.archived) continue;
    const c = monthCheck(d, a.id);
    if (!c || c.diffRial === 0) continue;
    if (a.balanceOk && a.balanceOk.key === c.key && a.balanceOk.diffRial === c.diffRial) continue;
    out.push(c);
  }
  return out;
}

/** Answer ①: a transaction was not booked — book it now, at the bank's moment, with the category the user picks. */
export function bookMissing(d: FinanceData, accountId: string, opts: { categoryId: string | null; note?: string }): string | null {
  const c = monthCheck(d, accountId);
  if (!c || c.diffRial === 0) return null;
  const t: Txn = {
    id: newId('t'),
    date: c.reported.date,
    time: c.reported.time ?? null,
    kind: c.diffRial < 0 ? 'expense' : 'income',
    amountRial: Math.abs(c.diffRial),
    accountId,
    categoryId: opts.categoryId ?? (c.diffRial < 0 ? 'c-other' : 'i-other'),
    note: opts.note?.trim() || 'تراکنش جاافتاده (از اختلاف با موجودی بانک)',
  };
  d.txns.push(t);
  return t.id;
}

/** Answer ②: the month-start balance was wrong. Only when it came from the opening balance (the one number the app could not know). */
export function fixStart(d: FinanceData, accountId: string): number {
  const c = monthCheck(d, accountId);
  const a = d.accounts.find((x) => x.id === accountId);
  if (!c || !a || c.diffRial === 0 || c.startFrom !== 'opening') return 0;
  a.openingRial += c.diffRial;
  return c.diffRial;
}

/** Answer ③: leave it — not asked again until the bank states a new balance. */
export function ignoreCheck(d: FinanceData, accountId: string) {
  const c = monthCheck(d, accountId);
  const a = d.accounts.find((x) => x.id === accountId);
  if (!c || !a) return;
  a.balanceOk = { key: c.key, diffRial: c.diffRial };
}
