import { accountBalances, addDays, daysBetween, upcoming, type ForecastPoint } from './calc';
import type { FinanceData, Iso } from './model';

/** Personal spendable cash only: investments, exchange wallets, business and receivables
 * cannot fund a household payment until the user records a withdrawal/transfer. */
export function liquidityPlan(d: FinanceData, today: Iso, days: 30 | 90 = 30, includeExpected = false) {
  const book: FinanceData = {
    ...d,
    txns: d.txns.filter((t) => t.date <= today),
    accounts: d.accounts.filter((a) => a.openedOn <= today).map((a) => ({
      ...a,
      reported: a.reported && a.reported.date > today ? null : a.reported,
    })),
  };
  const cashAccounts = book.accounts.filter((a) => !a.archived && !a.bizId && !a.exchange && ['bank', 'cash', 'wallet'].includes(a.kind));
  const cashIds = new Set(cashAccounts.map((a) => a.id));
  const balances = accountBalances(book);
  const startRial = cashAccounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  const personalIds = new Set(d.accounts.filter((a) => !a.bizId).map((a) => a.id));
  const expenses = book.txns.filter((t) => t.kind === 'expense' && personalIds.has(t.accountId) && !t.link);
  const from = addDays(today, -89);
  const first = expenses.reduce<Iso | null>((a, t) => a === null || t.date < a ? t.date : a, null);
  const basisDays = first === null ? 0 : daysBetween(first > from ? first : from, today) + 1;
  // Short histories are explicitly marked in the UI; never inflate a single day's spend 30x.
  const dailyRial = expenses.filter((t) => t.date >= from).reduce((s, t) => s + t.amountRial, 0) / Math.max(30, basisDays);
  const dues = upcoming(book, today, days).filter((x) => x.type !== 'lend' || personalIds.has(x.refId));
  const outflows = dues.filter((x) => x.rial < 0);
  // A late salary/receivable has no reliable receipt date: neither scenario assumes it arrives today.
  const inflows = dues.filter((x) => x.rial > 0 && !x.overdue);
  const events = new Map<Iso, number>();
  for (const x of [...outflows, ...(includeExpected ? inflows : [])]) {
    const date = x.date < today ? today : x.date;
    events.set(date, (events.get(date) ?? 0) + x.rial);
  }
  let balance = startRial;
  const points: ForecastPoint[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    // Today is a balance snapshot; estimate spending for the following full days.
    balance += (events.get(date) ?? 0) - (i > 0 ? dailyRial : 0);
    points.push({ date, balanceRial: Math.round(balance) });
  }
  const low = points.reduce((a, b) => b.balanceRial < a.balanceRial ? b : a);
  return {
    points, low, startRial, basisDays, dailyRial,
    endRial: points[points.length - 1].balanceRial,
    firstShortfall: points.find((p) => p.balanceRial < 0) ?? null,
    obligationsRial: -outflows.reduce((s, x) => s + x.rial, 0),
    expectedRial: inflows.reduce((s, x) => s + x.rial, 0),
    overdueReceiptsRial: dues.filter((x) => x.rial > 0 && x.overdue).reduce((s, x) => s + x.rial, 0),
    cashAccountCount: cashIds.size,
  };
}
