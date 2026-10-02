// مالی شخصی — pure calculations. No React, no storage, no network: everything here is fed the
// document and "today" explicitly so scripts/finance-test.ts can pin the arithmetic.
//
// Units: inputs and outputs are RIAL unless a name says otherwise (`…Toman`).
import { isoToJalali, jalaliMonthLength, jalaliToIso, JALALI_MONTHS } from '@/lib/jalali';
import type { Bill, Cheque, ExpectedIncome, FinanceData, Goal, Iso, Loan, MarketKey, Txn } from './model';

// ── dates ──────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const isoMs = (iso: Iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const msIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: Iso, n: number) => msIso(isoMs(iso) + n * DAY);
export const daysBetween = (a: Iso, b: Iso) => Math.round((isoMs(b) - isoMs(a)) / DAY);

export interface JMonth {
  jy: number;
  jm: number;
}
export const monthKey = (m: JMonth) => `${m.jy}-${m.jm}`;
export const monthOf = (iso: Iso): JMonth => {
  const j = isoToJalali(iso);
  return { jy: j.jy, jm: j.jm };
};
export const shiftMonth = (m: JMonth, n: number): JMonth => {
  const idx = m.jy * 12 + (m.jm - 1) + n;
  return { jy: Math.floor(idx / 12), jm: (idx % 12) + 1 };
};
export const monthLabel = (m: JMonth) => `${JALALI_MONTHS[m.jm - 1]} ${new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(m.jy)}`;

/** First and last Gregorian day of a Jalali month. */
export function monthBounds(m: JMonth): { from: Iso; to: Iso } {
  return { from: jalaliToIso(m.jy, m.jm, 1), to: jalaliToIso(m.jy, m.jm, jalaliMonthLength(m.jy, m.jm)) };
}

/** A Jalali day in a given month, clamped to the month's length (31 → 29/30 in the second half-year). */
export function dayInMonth(m: JMonth, day: number): Iso {
  return jalaliToIso(m.jy, m.jm, Math.max(1, Math.min(day, jalaliMonthLength(m.jy, m.jm))));
}

/** Same Jalali day-of-month, `n` months later — how Iranian banks schedule installments. */
export function addJalaliMonths(iso: Iso, n: number): Iso {
  const j = isoToJalali(iso);
  return dayInMonth(shiftMonth({ jy: j.jy, jm: j.jm }, n), j.jd);
}

// ── accounts ───────────────────────────────────────────────────────────────

/** Current balance of every account: opening balance plus every transaction since. */
export function accountBalances(d: FinanceData): Record<string, number> {
  const bal: Record<string, number> = {};
  for (const a of d.accounts) bal[a.id] = a.openingRial;
  for (const t of d.txns) {
    if (!(t.accountId in bal)) continue;
    if (t.kind === 'income') bal[t.accountId] += t.amountRial;
    else if (t.kind === 'expense') bal[t.accountId] -= t.amountRial;
    else if (t.kind === 'transfer') {
      bal[t.accountId] -= t.amountRial;
      if (t.toAccountId && t.toAccountId in bal) bal[t.toAccountId] += t.amountRial;
    }
  }
  return bal;
}

// ── month totals and budgets ───────────────────────────────────────────────

export interface MonthTotals {
  incomeRial: number;
  expenseRial: number;
  netRial: number;
  /** share of income kept; null when there was no income */
  savingsRatePct: number | null;
  byCategory: { categoryId: string | null; rial: number; count: number }[];
  count: number;
}

const inRange = (t: Txn, from: Iso, to: Iso) => t.date >= from && t.date <= to;

/** Transfers between the user's own accounts are neither income nor spending, so they are left out. */
export function totalsBetween(d: FinanceData, from: Iso, to: Iso): MonthTotals {
  let incomeRial = 0;
  let expenseRial = 0;
  let count = 0;
  const by = new Map<string | null, { rial: number; count: number }>();
  for (const t of d.txns) {
    if (t.kind === 'transfer' || !inRange(t, from, to)) continue;
    count++;
    if (t.kind === 'income') incomeRial += t.amountRial;
    else {
      expenseRial += t.amountRial;
      const k = t.categoryId ?? null;
      const e = by.get(k) ?? { rial: 0, count: 0 };
      e.rial += t.amountRial;
      e.count++;
      by.set(k, e);
    }
  }
  return {
    incomeRial,
    expenseRial,
    netRial: incomeRial - expenseRial,
    savingsRatePct: incomeRial > 0 ? ((incomeRial - expenseRial) / incomeRial) * 100 : null,
    byCategory: [...by.entries()].map(([categoryId, v]) => ({ categoryId, ...v })).sort((a, b) => b.rial - a.rial),
    count,
  };
}

export function monthTotals(d: FinanceData, m: JMonth): MonthTotals {
  const { from, to } = monthBounds(m);
  return totalsBetween(d, from, to);
}

export interface BudgetLine {
  categoryId: string;
  limitRial: number;
  spentRial: number;
  usedPct: number;
  /** how far through the month we are, percent — spending ahead of this is "running hot" */
  pacePct: number;
  status: 'ok' | 'hot' | 'over';
}

export function budgetStatus(d: FinanceData, m: JMonth, today: Iso): BudgetLine[] {
  const t = monthTotals(d, m);
  const spent = new Map(t.byCategory.map((c) => [c.categoryId, c.rial]));
  const { from, to } = monthBounds(m);
  const len = daysBetween(from, to) + 1;
  const pacePct = today < from ? 0 : today > to ? 100 : ((daysBetween(from, today) + 1) / len) * 100;
  return d.budgets
    .filter((b) => b.monthlyRial > 0)
    .map((b) => {
      const s = spent.get(b.categoryId) ?? 0;
      const usedPct = (s / b.monthlyRial) * 100;
      const status: BudgetLine['status'] = usedPct > 100 ? 'over' : usedPct > pacePct + 10 ? 'hot' : 'ok';
      return { categoryId: b.categoryId, limitRial: b.monthlyRial, spentRial: s, usedPct, pacePct, status };
    })
    .sort((a, b) => b.usedPct - a.usedPct);
}

/**
 * Average monthly spending and income over the last 90 days, scaled to the span the user has
 * actually been recording — someone who started a week ago has not spent "a quarter of a month".
 */
export function monthlyAverages(d: FinanceData, today: Iso): { expenseRial: number; incomeRial: number; basisDays: number } {
  const from = addDays(today, -89);
  const dated = d.txns.filter((t) => t.kind !== 'transfer' && t.date <= today).map((t) => t.date);
  if (!dated.length) return { expenseRial: 0, incomeRial: 0, basisDays: 0 };
  const first = dated.reduce((a, b) => (a < b ? a : b));
  const start = first > from ? first : from;
  const basisDays = daysBetween(start, today) + 1;
  const tot = totalsBetween(d, start, today);
  const perMonth = 30 / Math.max(basisDays, 30); // never extrapolate a few days into a whole month
  return { expenseRial: tot.expenseRial * perMonth, incomeRial: tot.incomeRial * perMonth, basisDays };
}

// ── loans ──────────────────────────────────────────────────────────────────

export interface Installment {
  n: number;
  dueDate: Iso;
  paymentRial: number;
  interestRial: number;
  principalRial: number;
  remainingRial: number;
}

/**
 * Equal-installment (annuity) schedule, the method Iranian banks use for consumer and housing loans:
 * A = P·r(1+r)^n / ((1+r)^n − 1) with r = annual/12. Each payment is rounded to the rial and the
 * final one absorbs the rounding so the principal repaid sums exactly to the amount borrowed.
 */
export function loanSchedule(l: Pick<Loan, 'principalRial' | 'annualRatePct' | 'months' | 'firstDueDate'>): Installment[] {
  const n = Math.max(1, Math.round(l.months));
  const r = l.annualRatePct / 1200;
  const pay = r === 0 ? l.principalRial / n : (l.principalRial * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  const out: Installment[] = [];
  let rem = l.principalRial;
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(rem * r);
    let principal = Math.round(pay) - interest;
    if (i === n) principal = rem;
    rem -= principal;
    out.push({ n: i, dueDate: addJalaliMonths(l.firstDueDate, i - 1), paymentRial: principal + interest, interestRial: interest, principalRial: principal, remainingRial: rem });
  }
  return out;
}

export interface LoanState {
  installmentRial: number;
  totalInterestRial: number;
  remainingPrincipalRial: number;
  remainingPaymentsRial: number;
  remainingCount: number;
  next: Installment | null;
  overdue: Installment[];
  done: boolean;
}

export function loanState(l: Loan, today: Iso): LoanState {
  const s = loanSchedule(l);
  const paid = Math.min(Math.max(0, l.paidCount), s.length);
  const left = s.slice(paid);
  return {
    installmentRial: s[0]?.paymentRial ?? 0,
    totalInterestRial: s.reduce((a, x) => a + x.interestRial, 0),
    remainingPrincipalRial: paid ? s[paid - 1].remainingRial : l.principalRial,
    remainingPaymentsRial: left.reduce((a, x) => a + x.paymentRial, 0),
    remainingCount: left.length,
    next: left[0] ?? null,
    overdue: left.filter((x) => x.dueDate < today),
    done: left.length === 0,
  };
}

/** Effective annual cost of a loan, so a "4% فی‌مابه‌التفاوت" quote and a 23% annual quote compare. */
export function effectiveAnnualPct(annualRatePct: number): number {
  return ((1 + annualRatePct / 1200) ** 12 - 1) * 100;
}

// ── upcoming obligations & cash-flow forecast ──────────────────────────────

export interface Due {
  key: string;
  date: Iso;
  /** + money coming in, − money going out */
  rial: number;
  label: string;
  type: 'loan' | 'cheque' | 'bill' | 'income';
  refId: string;
  n?: number;
  monthKey?: string;
  overdue: boolean;
}

/**
 * Unpaid due dates of a bill from the current Jalali month up to `horizon`. Earlier months are not
 * chased: the app cannot know whether a bill was paid before the user started recording it.
 */
export function billDueDates(b: Bill, today: Iso, horizon: Iso): { date: Iso; mk: string }[] {
  if (!b.active) return [];
  const out: { date: Iso; mk: string }[] = [];
  for (let m = monthOf(today); ; m = shiftMonth(m, 1)) {
    const date = dayInMonth(m, b.dueDay);
    if (date > horizon) break;
    const mk = monthKey(m);
    if (!b.paidMonths.includes(mk)) out.push({ date, mk });
  }
  return out;
}

/**
 * Dates an expected income has not been received for, up to `horizon`: monthly ones from their first
 * month (a salary that is late shows as overdue), a one-off one on its date until it is received.
 */
export function incomeDueDates(x: ExpectedIncome, today: Iso, horizon: Iso): { date: Iso; mk: string }[] {
  if (!x.active) return [];
  if (x.repeat === 'once') return x.date && x.date <= horizon && !x.receivedMonths.includes('once') ? [{ date: x.date, mk: 'once' }] : [];
  const out: { date: Iso; mk: string }[] = [];
  const [fy, fm] = x.fromMonth.split('-').map(Number);
  const cur = monthOf(today);
  const idx = (j: JMonth) => j.jy * 12 + j.jm;
  // never more than a year back, whatever fromMonth says
  let m: JMonth = fy && fm >= 1 && fm <= 12 ? { jy: fy, jm: fm } : cur;
  if (idx(m) < idx(cur) - 12) m = shiftMonth(cur, -12);
  for (; ; m = shiftMonth(m, 1)) {
    const date = dayInMonth(m, x.day);
    if (date > horizon) break;
    const mk = monthKey(m);
    if (!x.receivedMonths.includes(mk)) out.push({ date, mk });
  }
  return out;
}

export function upcoming(d: FinanceData, today: Iso, days = 30): Due[] {
  const horizon = addDays(today, days);
  const out: Due[] = [];
  for (const l of d.loans) {
    const sign = l.direction === 'borrowed' ? -1 : 1;
    const s = loanSchedule(l).slice(Math.max(0, l.paidCount));
    for (const x of s) {
      if (x.dueDate > horizon) break;
      out.push({ key: `loan:${l.id}:${x.n}`, date: x.dueDate, rial: sign * x.paymentRial, label: `قسط ${x.n.toLocaleString('fa-IR')} ${l.name}`, type: 'loan', refId: l.id, n: x.n, overdue: x.dueDate < today });
    }
  }
  for (const c of d.cheques as Cheque[]) {
    if (c.status !== 'pending' || c.dueDate > horizon) continue;
    out.push({ key: `cheque:${c.id}`, date: c.dueDate, rial: (c.direction === 'issued' ? -1 : 1) * c.amountRial, label: c.direction === 'issued' ? 'چک صادره' : 'چک دریافتی', type: 'cheque', refId: c.id, overdue: c.dueDate < today });
  }
  for (const b of d.bills) {
    for (const x of billDueDates(b, today, horizon)) {
      out.push({ key: `bill:${b.id}:${x.mk}`, date: x.date, rial: -b.amountRial, label: b.name, type: 'bill', refId: b.id, monthKey: x.mk, overdue: x.date < today });
    }
  }
  for (const inc of d.incomes ?? []) {
    for (const x of incomeDueDates(inc, today, horizon)) {
      out.push({ key: `income:${inc.id}:${x.mk}`, date: x.date, rial: inc.amountRial, label: inc.name, type: 'income', refId: inc.id, monthKey: x.mk, overdue: x.date < today });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rial - b.rial));
}

export interface ForecastPoint {
  date: Iso;
  balanceRial: number;
}

/**
 * Liquid money day by day for the next `days`, applying only the obligations the user entered.
 * The low point is what matters: a negative low point means an issued cheque or an installment
 * will bounce unless money is moved in before that date.
 */
export function cashForecast(d: FinanceData, today: Iso, days = 30): { points: ForecastPoint[]; low: ForecastPoint; startRial: number } {
  const bal = accountBalances(d);
  const startRial = d.accounts.filter((a) => !a.archived).reduce((s, a) => s + (bal[a.id] ?? 0), 0);
  const dues = upcoming(d, today, days);
  // anything overdue or due today is treated as settled today
  let run = startRial + dues.filter((x) => x.date <= today).reduce((s, x) => s + x.rial, 0);
  const points: ForecastPoint[] = [{ date: today, balanceRial: run }];
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    for (const x of dues) if (x.date === date) run += x.rial;
    points.push({ date, balanceRial: run });
  }
  const low = points.reduce((a, b) => (b.balanceRial < a.balanceRial ? b : a));
  return { points, low, startRial };
}

// ── month forecast: what comes in and goes out by the end of a month ──────

export interface MonthForecast {
  month: JMonth;
  /** income already recorded in the month */
  incomeActualRial: number;
  /** still to come: the expected incomes the user entered (or, with none entered, the average) */
  incomeExpectedRial: number;
  incomeBasis: 'entered' | 'average' | 'none';
  /** expected incomes of the month not received yet, for the list */
  incomeLines: { label: string; date: Iso; rial: number; overdue: boolean }[];
  expenseActualRial: number;
  /** installments, bills and issued cheques still due in the month */
  obligationsRial: number;
  /** everyday spending still to come, at the pace of the last 90 days (without bills and installments) */
  everydayRial: number;
  /** income − expense for the whole month, actual + expected */
  netRial: number;
}

/**
 * The month as it will probably end: what is already recorded, plus what is known to come
 * (expected incomes, installments, bills, cheques), plus everyday spending at its recent pace for
 * the days left. With no expected income entered, the average monthly income stands in for it and
 * the basis says so — a forecast built on a guess must look like one.
 */
export function monthForecast(d: FinanceData, m: JMonth, today: Iso): MonthForecast {
  const { from, to } = monthBounds(m);
  // a month that has not started has nothing recorded yet (future-dated entries are plans, not actuals)
  const actual = today >= from ? totalsBetween(d, from, today < to ? today : to) : { incomeRial: 0, expenseRial: 0 };
  const past = to < today;
  const horizon = daysBetween(today, to);
  const dues = horizon >= 0 ? upcoming(d, today, horizon).filter((x) => x.date >= from && x.date <= to) : [];
  const incomeLines = dues.filter((x) => x.type === 'income').map((x) => ({ label: x.label, date: x.date, rial: x.rial, overdue: x.overdue }));
  const obligationsRial = -dues.filter((x) => x.rial < 0).reduce((s, x) => s + x.rial, 0);
  const chequesIn = dues.filter((x) => x.type === 'cheque' && x.rial > 0).reduce((s, x) => s + x.rial, 0);
  const loansIn = dues.filter((x) => x.type === 'loan' && x.rial > 0).reduce((s, x) => s + x.rial, 0);

  let incomeExpectedRial = incomeLines.reduce((s, x) => s + x.rial, 0) + chequesIn + loansIn;
  let incomeBasis: MonthForecast['incomeBasis'] = (d.incomes ?? []).some((x) => x.active) ? 'entered' : 'none';
  const avg = monthlyAverages(d, today);
  if (incomeBasis === 'none' && !past && avg.incomeRial > 0) {
    incomeExpectedRial += Math.max(0, avg.incomeRial - actual.incomeRial);
    incomeBasis = 'average';
  }

  // everyday spending: expenses that are not an installment/bill/cheque payment, over the last 90 days
  const start = addDays(today, -89);
  const dated = d.txns.filter((t) => t.kind === 'expense' && t.date <= today).map((t) => t.date);
  let everydayRial = 0;
  if (dated.length && !past) {
    const first = dated.reduce((a, b) => (a < b ? a : b));
    const s0 = first > start ? first : start;
    const basisDays = Math.max(30, daysBetween(s0, today) + 1);
    const everyday = d.txns.filter((t) => t.kind === 'expense' && !t.link && t.date >= s0 && t.date <= today).reduce((s, t) => s + t.amountRial, 0);
    const daysLeft = today < from ? daysBetween(from, to) + 1 : Math.max(0, daysBetween(today, to));
    everydayRial = (everyday / basisDays) * daysLeft;
  }
  return {
    month: m,
    incomeActualRial: actual.incomeRial,
    incomeExpectedRial,
    incomeBasis,
    incomeLines,
    expenseActualRial: actual.expenseRial,
    obligationsRial,
    everydayRial,
    netRial: actual.incomeRial + incomeExpectedRial - actual.expenseRial - obligationsRial - everydayRial,
  };
}

// ── assets & net worth ─────────────────────────────────────────────────────

export interface PriceItem {
  key: string;
  price: number | null;
  unit: 'toman' | 'usd' | 'point';
  /** not a live quote: the last price on record, from this day (holiday, feed down — prices.ts) */
  asOf?: string | null;
}

/**
 * Rial price of one unit of a market asset, and the day it is from when it is not live. Items
 * quoted in USD (BTC, ETH) are converted with the board's own tether rate — never added as if
 * their dollar price were toman (CLAUDE.md rule 2); the older of the two dates is the price's date.
 */
export function unitPrice(key: MarketKey, items: PriceItem[]): { rial: number; asOf: Iso | null } | null {
  const it = items.find((x) => x.key === key);
  if (!it || typeof it.price !== 'number' || !(it.price > 0)) return null;
  if (it.unit === 'toman') return { rial: it.price * 10, asOf: it.asOf ?? null };
  if (it.unit === 'usd') {
    const usdt = items.find((x) => x.key === 'usdt');
    if (!(usdt && usdt.unit === 'toman' && typeof usdt.price === 'number' && usdt.price > 0)) return null;
    const dates = [it.asOf, usdt.asOf].filter((x): x is string => !!x).sort();
    return { rial: it.price * usdt.price * 10, asOf: dates[0] ?? null };
  }
  return null;
}

export function unitPriceRial(key: MarketKey, items: PriceItem[]): number | null {
  return unitPrice(key, items)?.rial ?? null;
}

export interface NetWorth {
  cashRial: number;
  marketRial: number;
  manualRial: number;
  liquidRial: number;
  receivableRial: number;
  debtRial: number;
  netRial: number;
  /** market assets with no price at all, not even a last one — excluded, not zeroed silently */
  unpriced: string[];
  /** market assets valued at the last price on record (market closed, feed down), with its day */
  lastPriced: { name: string; asOf: Iso }[];
  byAsset: { id: string; name: string; rial: number | null; liquid: boolean; asOf?: Iso | null }[];
}

export function netWorth(d: FinanceData, items: PriceItem[], today: Iso): NetWorth {
  const bal = accountBalances(d);
  const cashRial = d.accounts.filter((a) => !a.archived).reduce((s, a) => s + (bal[a.id] ?? 0), 0);
  let marketRial = 0;
  let manualRial = 0;
  let liquidExtra = 0;
  const unpriced: string[] = [];
  const lastPriced: NetWorth['lastPriced'] = [];
  const byAsset: NetWorth['byAsset'] = [];
  for (const a of d.assets) {
    if (a.kind === 'market' && a.key) {
      const p = unitPrice(a.key, items);
      const v = p === null ? null : p.rial * (a.qty ?? 0);
      if (v === null) unpriced.push(a.name);
      else {
        marketRial += v;
        liquidExtra += v;
        if (p!.asOf) lastPriced.push({ name: a.name, asOf: p!.asOf });
      }
      byAsset.push({ id: a.id, name: a.name, rial: v, liquid: true, asOf: p?.asOf ?? null });
    } else {
      const v = a.valueRial ?? 0;
      manualRial += v;
      if (a.liquid) liquidExtra += v;
      byAsset.push({ id: a.id, name: a.name, rial: v, liquid: !!a.liquid });
    }
  }
  let receivableRial = 0;
  let debtRial = 0;
  for (const l of d.loans) {
    const st = loanState(l, today);
    if (l.direction === 'borrowed') debtRial += st.remainingPrincipalRial;
    else receivableRial += st.remainingPrincipalRial;
  }
  return {
    cashRial,
    marketRial,
    manualRial,
    liquidRial: cashRial + liquidExtra,
    receivableRial,
    debtRial,
    netRial: cashRial + marketRial + manualRial + receivableRial - debtRial,
    unpriced,
    lastPriced,
    byAsset,
  };
}

// ── goals ──────────────────────────────────────────────────────────────────

export interface GoalPlan {
  monthsLeft: number;
  /** what the target will cost on the target date (inflation applied when asked) */
  futureTargetRial: number;
  progressPct: number;
  /** monthly saving needed if the money just sits (0% return) */
  monthlyNoReturnRial: number;
  /** monthly saving needed if it is kept in a fixed-income fund at `safeYieldPct` */
  monthlyAtSafeYieldRial: number;
  /** real (inflation-adjusted) return of that fund — negative means the fund alone loses ground */
  realSafeYieldPct: number;
  reached: boolean;
}

export function goalPlan(g: Goal, today: Iso, inflationPct: number, safeYieldPct: number): GoalPlan {
  const monthsLeft = Math.max(0, daysBetween(today, g.targetDate) / 30.44);
  const years = monthsLeft / 12;
  const futureTargetRial = g.inflationAdjust ? g.targetRial * (1 + inflationPct / 100) ** years : g.targetRial;
  const gap = Math.max(0, futureTargetRial - g.savedRial);
  const n = Math.max(monthsLeft, 1e-9);
  const monthlyNoReturnRial = monthsLeft >= 1 ? gap / n : gap;
  const m = (1 + safeYieldPct / 100) ** (1 / 12) - 1;
  let monthlyAtSafeYieldRial: number;
  if (monthsLeft < 1) monthlyAtSafeYieldRial = gap;
  else {
    const grownSaved = g.savedRial * (1 + m) ** n;
    const rest = Math.max(0, futureTargetRial - grownSaved);
    monthlyAtSafeYieldRial = m > 0 ? (rest * m) / ((1 + m) ** n - 1) : rest / n;
  }
  return {
    monthsLeft,
    futureTargetRial,
    progressPct: futureTargetRial > 0 ? Math.min(100, (g.savedRial / futureTargetRial) * 100) : 100,
    monthlyNoReturnRial,
    monthlyAtSafeYieldRial,
    realSafeYieldPct: ((1 + safeYieldPct / 100) / (1 + inflationPct / 100) - 1) * 100,
    reached: g.savedRial >= futureTargetRial,
  };
}

// ── health indicators ──────────────────────────────────────────────────────

export interface Health {
  avgExpenseRial: number;
  avgIncomeRial: number;
  basisDays: number;
  /** how many months of average spending the liquid money covers */
  emergencyMonths: number | null;
  /** monthly installments (borrowed loans) as a share of average income */
  debtServicePct: number | null;
  monthlyInstallmentsRial: number;
  monthlyBillsRial: number;
  savingsRatePct: number | null;
}

export function health(d: FinanceData, items: PriceItem[], today: Iso): Health {
  const avg = monthlyAverages(d, today);
  const nw = netWorth(d, items, today);
  const monthlyInstallmentsRial = d.loans
    .filter((l) => l.direction === 'borrowed')
    .reduce((s, l) => {
      const st = loanState(l, today);
      return s + (st.done ? 0 : st.installmentRial);
    }, 0);
  const monthlyBillsRial = d.bills.filter((b) => b.active).reduce((s, b) => s + b.amountRial, 0);
  return {
    avgExpenseRial: avg.expenseRial,
    avgIncomeRial: avg.incomeRial,
    basisDays: avg.basisDays,
    emergencyMonths: avg.expenseRial > 0 ? nw.liquidRial / avg.expenseRial : null,
    debtServicePct: avg.incomeRial > 0 ? (monthlyInstallmentsRial / avg.incomeRial) * 100 : null,
    monthlyInstallmentsRial,
    monthlyBillsRial,
    savingsRatePct: avg.incomeRial > 0 ? ((avg.incomeRial - avg.expenseRial) / avg.incomeRial) * 100 : null,
  };
}

// ── simple calculators (tools page) ────────────────────────────────────────

/** What `amount` today is worth in today's money after `years` at `inflationPct`. */
export const realValue = (amount: number, years: number, inflationPct: number) => amount / (1 + inflationPct / 100) ** years;

/** Real (inflation-adjusted) annual return, percent — the number that says whether a choice beat inflation. */
export const realReturnPct = (nominalPct: number, inflationPct: number) => ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;

// ── advisor summary (the ONLY thing that leaves the device) ────────────────

const T = (rial: number) => Math.round(rial / 10); // → toman, rounded

/**
 * A numbers-only digest of the user's finances for the advisor. Deliberately excludes free-text
 * notes, cheque counterparties and account names — category, loan and goal names are kept because
 * the advice is meaningless without them. The UI shows this exact object before anything is sent.
 */
export function advisorSummary(d: FinanceData, items: PriceItem[], today: Iso) {
  const cur = monthOf(today);
  const prev = shiftMonth(cur, -1);
  const catName = (id: string | null) => d.categories.find((c) => c.id === id)?.name ?? 'بدون دسته';
  const mt = (m: JMonth) => {
    const t = monthTotals(d, m);
    return {
      month: monthLabel(m),
      incomeToman: T(t.incomeRial),
      expenseToman: T(t.expenseRial),
      savingsRatePct: t.savingsRatePct === null ? null : Math.round(t.savingsRatePct),
      topExpenses: t.byCategory.slice(0, 8).map((c) => ({ category: catName(c.categoryId), toman: T(c.rial), count: c.count })),
    };
  };
  const nw = netWorth(d, items, today);
  const h = health(d, items, today);
  const fc = cashForecast(d, today, 30);
  const dues = upcoming(d, today, 30);
  return {
    unit: 'تمام مبالغ به تومان',
    today: monthLabel(cur),
    settings: { expectedInflationPct: d.settings.inflationPct, fixedIncomeYieldPct: d.settings.safeYieldPct, emergencyTargetMonths: d.settings.emergencyMonths },
    thisMonth: mt(cur),
    lastMonth: mt(prev),
    averages: { monthlyExpenseToman: T(h.avgExpenseRial), monthlyIncomeToman: T(h.avgIncomeRial), basisDays: h.basisDays },
    budgets: budgetStatus(d, cur, today).map((b) => ({ category: catName(b.categoryId), limitToman: T(b.limitRial), spentToman: T(b.spentRial), usedPct: Math.round(b.usedPct), monthElapsedPct: Math.round(b.pacePct) })),
    netWorth: {
      cashAndBankToman: T(nw.cashRial),
      marketAssetsToman: T(nw.marketRial),
      otherAssetsToman: T(nw.manualRial),
      receivablesToman: T(nw.receivableRial),
      debtsToman: T(nw.debtRial),
      netToman: T(nw.netRial),
      liquidToman: T(nw.liquidRial),
      assets: nw.byAsset.map((a) => ({ name: a.name, toman: a.rial === null ? null : T(a.rial), liquid: a.liquid })),
      unpricedAssets: nw.unpriced,
    },
    loans: d.loans.map((l) => {
      const st = loanState(l, today);
      return {
        name: l.name,
        direction: l.direction === 'borrowed' ? 'بدهی من' : 'طلب من',
        annualRatePct: l.annualRatePct,
        installmentToman: T(st.installmentRial),
        remainingPrincipalToman: T(st.remainingPrincipalRial),
        remainingInstallments: st.remainingCount,
        overdueInstallments: st.overdue.length,
      };
    }),
    monthlyBillsToman: T(h.monthlyBillsRial),
    // amounts only: the names the user gave expected incomes stay on the device (rule 7)
    expectedIncome: {
      monthlyToman: T((d.incomes ?? []).filter((x) => x.active && x.repeat === 'monthly').reduce((s, x) => s + x.amountRial, 0)),
      oneOffNext90DaysToman: T(upcoming(d, today, 90).filter((x) => x.type === 'income' && (d.incomes ?? []).find((i) => i.id === x.refId)?.repeat === 'once').reduce((s, x) => s + x.rial, 0)),
    },
    nextMonthForecast: (() => {
      const f = monthForecast(d, shiftMonth(cur, 1), today);
      return { month: monthLabel(f.month), incomeToman: T(f.incomeExpectedRial), incomeBasis: f.incomeBasis, obligationsToman: T(f.obligationsRial), everydaySpendingToman: T(f.everydayRial), savingsToman: T(f.netRial) };
    })(),
    next30Days: {
      outflowToman: T(-dues.filter((x) => x.rial < 0).reduce((s, x) => s + x.rial, 0)),
      inflowToman: T(dues.filter((x) => x.rial > 0).reduce((s, x) => s + x.rial, 0)),
      overdueCount: dues.filter((x) => x.overdue).length,
      lowestCashToman: T(fc.low.balanceRial),
    },
    health: {
      emergencyMonthsCovered: h.emergencyMonths === null ? null : +h.emergencyMonths.toFixed(1),
      debtServiceToIncomePct: h.debtServicePct === null ? null : Math.round(h.debtServicePct),
      savingsRatePct: h.savingsRatePct === null ? null : Math.round(h.savingsRatePct),
    },
    goals: d.goals.map((g) => {
      const p = goalPlan(g, today, d.settings.inflationPct, d.settings.safeYieldPct);
      return {
        name: g.name,
        targetTodayToman: T(g.targetRial),
        targetOnDateToman: T(p.futureTargetRial),
        savedToman: T(g.savedRial),
        monthsLeft: +p.monthsLeft.toFixed(1),
        monthlyNeededAtFixedIncomeToman: T(p.monthlyAtSafeYieldRial),
      };
    }),
  };
}

export type AdvisorSummary = ReturnType<typeof advisorSummary>;


/**
 * Annual rate (nominal, ×12) hidden inside an installment offer: cash price `cash`, down payment
 * `down`, then `n` equal monthly payments of `payment`. Solved by bisection on the annuity formula.
 * Returns null when the offer is not a loan at all (installments sum to less than what is financed).
 */
export function impliedAnnualRatePct(cash: number, down: number, payment: number, n: number): number | null {
  const financed = cash - down;
  if (!(financed > 0) || !(payment > 0) || !(n >= 1)) return null;
  if (payment * n < financed) return null;
  const pv = (r: number) => (r === 0 ? payment * n : (payment * (1 - (1 + r) ** -n)) / r);
  let lo = 0;
  let hi = 1; // 100% a month is beyond any real offer
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > financed) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 1200;
}
