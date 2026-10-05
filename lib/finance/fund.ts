// صندوق خانگی — a family/friends fund (CLAUDE.md rule 77). Pure: everything takes the book and changes it.
//
// Members pay a monthly share (shares × shareRial). The pooled money is lent, interest-free, to one member
// at a time — by lottery or by turn — and the borrower repays it in monthly installments on top of the share.
// Everyone gets a loan before anyone gets a second one (a «round»).
//
// The fund's own ledger holds every member's payments (the app works for the one keeping the books, or for a
// member tracking only their own row). The user's own money also moves in their book, through one account
// per fund (kind 'homefund'): a share or an installment is a transfer into it, the loan a transfer out of it.
// That account's balance is exactly the user's position in the fund — what the fund owes them (+) or they
// owe the fund (−) — so net worth is right and no share is counted as spending.
import { monthKey, monthLabel, monthOf, shiftMonth, type JMonth } from './calc';
import { newId, type FinanceData, type FundLoan, type FundMember, type FundPayment, type HomeFund, type Iso, type MonthKey, type Txn } from './model';

export const parseMonth = (mk: MonthKey): JMonth => {
  const [jy, jm] = mk.split('-').map(Number);
  return { jy, jm };
};
export const monthKeyOf = (iso: Iso): MonthKey => monthKey(monthOf(iso));
export const nextMonth = (mk: MonthKey, n = 1): MonthKey => monthKey(shiftMonth(parseMonth(mk), n));
export const cmpMonth = (a: MonthKey, b: MonthKey) => {
  const x = parseMonth(a);
  const y = parseMonth(b);
  return x.jy - y.jy || x.jm - y.jm;
};
export const monthLabelOf = (mk: MonthKey) => monthLabel(parseMonth(mk));
/** start…end, inclusive */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; cmpMonth(m, to) <= 0 && out.length < 600; m = nextMonth(m)) out.push(m);
  return out;
}

/** Installment n (1-based) of a loan: equal parts, the last one takes the rounding so they add up exactly. */
export function installmentRial(l: Pick<FundLoan, 'rial' | 'installments'>, n: number): number {
  const base = Math.floor(l.rial / l.installments / 10) * 10; // whole toman
  return n < l.installments ? base : l.rial - base * (l.installments - 1);
}
/** Which installment of the loan falls in this month (installments start the month after the loan), or 0. */
export function installmentNo(l: Pick<FundLoan, 'month' | 'installments'>, mk: MonthKey): number {
  let k = 0;
  for (let m = nextMonth(l.month); k < l.installments; m = nextMonth(m)) {
    k++;
    if (m === mk) return k;
    if (cmpMonth(m, mk) > 0) return 0;
  }
  return 0;
}

export interface Due {
  memberId: string;
  month: MonthKey;
  shareRial: number;
  repay: { loanId: string; n: number; rial: number }[];
}
/** What a member owes the fund for a month. */
export function dueFor(f: HomeFund, memberId: string, mk: MonthKey): Due {
  const m = f.members.find((x) => x.id === memberId);
  const active = !!m && !m.left && cmpMonth(mk, f.startMonth) >= 0;
  const repay: Due['repay'] = [];
  for (const l of f.loans) {
    if (l.memberId !== memberId) continue;
    const n = installmentNo(l, mk);
    if (n) repay.push({ loanId: l.id, n, rial: installmentRial(l, n) });
  }
  return { memberId, month: mk, shareRial: active ? (m!.shares || 1) * f.shareRial : 0, repay };
}

export const paymentsOf = (f: HomeFund, memberId: string, mk: MonthKey, kind?: FundPayment['kind'], loanId?: string) =>
  f.payments.filter((p) => p.memberId === memberId && p.month === mk && (!kind || p.kind === kind) && (!loanId || p.loanId === loanId));

export interface MemberState {
  member: FundMember;
  sharesPaidRial: number;
  /** shares due up to and including the month, minus what was paid */
  shareArrearsRial: number;
  loansRial: number;
  repaidRial: number;
  /** loan money still to repay */
  owedRial: number;
  /** installments due up to the month and not paid */
  repayArrearsRial: number;
  loans: number;
}
export function memberState(f: HomeFund, memberId: string, upTo: MonthKey): MemberState {
  const member = f.members.find((x) => x.id === memberId)!;
  let shareDue = 0;
  let repayDue = 0;
  for (const mk of monthsBetween(f.startMonth, upTo)) {
    const d = dueFor(f, memberId, mk);
    shareDue += d.shareRial;
    repayDue += d.repay.reduce((s, r) => s + r.rial, 0);
  }
  const mine = f.payments.filter((p) => p.memberId === memberId);
  const sharesPaidRial = mine.filter((p) => p.kind === 'share').reduce((s, p) => s + p.rial, 0);
  const sharesPaidUpTo = mine.filter((p) => p.kind === 'share' && cmpMonth(p.month, upTo) <= 0).reduce((s, p) => s + p.rial, 0);
  const repaidRial = mine.filter((p) => p.kind === 'repay').reduce((s, p) => s + p.rial, 0);
  const repaidUpTo = mine.filter((p) => p.kind === 'repay' && cmpMonth(p.month, upTo) <= 0).reduce((s, p) => s + p.rial, 0);
  const loans = f.loans.filter((l) => l.memberId === memberId);
  const loansRial = loans.reduce((s, l) => s + l.rial, 0);
  return {
    member,
    sharesPaidRial,
    shareArrearsRial: Math.max(0, shareDue - sharesPaidUpTo),
    loansRial,
    repaidRial,
    owedRial: loansRial - repaidRial,
    repayArrearsRial: Math.max(0, repayDue - repaidUpTo),
    loans: loans.length,
  };
}

/** Cash in the fund: everything paid in, minus every loan paid out. */
export const fundCash = (f: HomeFund) => f.payments.reduce((s, p) => s + p.rial, 0) - f.loans.reduce((s, l) => s + l.rial, 0);

/** Who may get the next loan: active members with the fewest loans so far — everyone gets one before anyone gets a second (the round). */
export function eligible(f: HomeFund): FundMember[] {
  const active = f.members.filter((m) => !m.left);
  if (!active.length) return [];
  const count = (id: string) => f.loans.filter((l) => l.memberId === id).length;
  const least = Math.min(...active.map((m) => count(m.id)));
  return active.filter((m) => count(m.id) === least);
}

/** The lottery: a fair pick among the eligible (rand in [0,1), crypto by default). */
export function drawLottery(f: HomeFund, rand: () => number = cryptoRandom): FundMember | null {
  const e = eligible(f);
  if (!e.length) return null;
  return e[Math.min(e.length - 1, Math.floor(rand() * e.length))];
}
function cryptoRandom(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

const me = (f: HomeFund) => f.members.find((m) => m.me) ?? null;

export interface NewFund {
  name: string;
  shareRial: number;
  loanRial: number;
  installments: number;
  startMonth: MonthKey;
  members: { name: string; shares?: number; me?: boolean }[];
}
/** A new fund; when the user is a member, the account that carries their position in it. */
export function createFund(d: FinanceData, x: NewFund, today: Iso): string | string[] {
  const errs: string[] = [];
  if (!x.name.trim()) errs.push('نام صندوق را بنویسید.');
  if (!(x.shareRial > 0)) errs.push('مبلغ سهم ماهانه را بنویسید.');
  if (!(x.loanRial > 0)) errs.push('مبلغ وام را بنویسید.');
  if (!(x.installments >= 1)) errs.push('تعداد اقساط حداقل یک است.');
  const members = x.members.filter((m) => m.name.trim());
  if (members.length < 2) errs.push('دست‌کم دو عضو لازم است.');
  if (members.filter((m) => m.me).length > 1) errs.push('فقط یک عضو «من» است.');
  if (errs.length) return errs;
  const f: HomeFund = {
    id: newId('f'),
    name: x.name.trim(),
    shareRial: Math.round(x.shareRial),
    loanRial: Math.round(x.loanRial),
    installments: Math.round(x.installments),
    startMonth: x.startMonth,
    members: members.map((m) => ({ id: newId('m'), name: m.name.trim(), shares: Math.max(1, Math.round(m.shares ?? 1)), ...(m.me ? { me: true } : {}) })),
    loans: [],
    payments: [],
    accountId: null,
  };
  if (f.members.some((m) => m.me)) {
    const id = newId('a');
    d.accounts.push({ id, name: `صندوق خانگی: ${f.name}`, kind: 'homefund', openingRial: 0, openedOn: today });
    f.accountId = id;
  }
  (d.funds ??= []).push(f);
  return f.id;
}

function moneyTxn(d: FinanceData, from: string, to: string, rial: number, date: Iso, note: string, fundId: string): string {
  const t: Txn = { id: newId('t'), date, kind: 'transfer', amountRial: rial, accountId: from, toAccountId: to, note, link: { type: 'fund', id: fundId } };
  d.txns.push(t);
  return t.id;
}

/**
 * A member paid this month's share, or an installment. The user's own payment moves money in their book
 * (from `accountId` into the fund's account) when an account is given.
 */
export function pay(d: FinanceData, fundId: string, memberId: string, mk: MonthKey, what: 'share' | { loanId: string }, date: Iso, accountId?: string | null): string | null {
  const f = d.funds.find((x) => x.id === fundId);
  if (!f) return 'صندوق پیدا نشد.';
  const due = dueFor(f, memberId, mk);
  let rial: number;
  let loanId: string | null = null;
  if (what === 'share') {
    if (!due.shareRial) return 'این ماه سهمی ندارد.';
    if (paymentsOf(f, memberId, mk, 'share').length) return 'سهم این ماه قبلاً ثبت شده.';
    rial = due.shareRial;
  } else {
    const r = due.repay.find((x) => x.loanId === what.loanId);
    if (!r) return 'این ماه قسطی از این وام نیست.';
    if (paymentsOf(f, memberId, mk, 'repay', what.loanId).length) return 'قسط این ماه قبلاً ثبت شده.';
    rial = r.rial;
    loanId = what.loanId;
  }
  const p: FundPayment = { id: newId('p'), memberId, month: mk, kind: what === 'share' ? 'share' : 'repay', loanId, rial, date, txnId: null };
  const m = f.members.find((x) => x.id === memberId);
  if (m?.me && f.accountId && accountId) {
    p.txnId = moneyTxn(d, accountId, f.accountId, rial, date, `صندوق ${f.name}: ${what === 'share' ? 'سهم' : 'قسط وام'} ${monthLabelOf(mk)}`, f.id);
  }
  f.payments.push(p);
  return null;
}

/** A loan given to a member. The user's own loan arrives in `accountId`. Refused when the fund does not hold the money. */
export function giveLoan(
  d: FinanceData,
  fundId: string,
  memberId: string,
  mk: MonthKey,
  date: Iso,
  how: FundLoan['how'],
  opts: { rial?: number; installments?: number; accountId?: string | null; allowShort?: boolean } = {},
): string | null {
  const f = d.funds.find((x) => x.id === fundId);
  if (!f) return 'صندوق پیدا نشد.';
  const rial = Math.round(opts.rial ?? f.loanRial);
  const installments = Math.round(opts.installments ?? f.installments);
  if (!(rial > 0) || !(installments >= 1)) return 'مبلغ یا تعداد اقساط نامعتبر است.';
  if (!opts.allowShort && fundCash(f) < rial) return `موجودی صندوق (${Math.round(fundCash(f) / 10).toLocaleString('fa-IR')} تومان) برای این وام کافی نیست.`;
  const l: FundLoan = { id: newId('l'), memberId, month: mk, date, rial, installments, how, txnId: null };
  const m = f.members.find((x) => x.id === memberId);
  if (m?.me && f.accountId && opts.accountId) l.txnId = moneyTxn(d, f.accountId, opts.accountId, rial, date, `صندوق ${f.name}: وام`, f.id);
  f.loans.push(l);
  return null;
}

/** Undo a payment (and its transaction). */
export function undoPayment(d: FinanceData, fundId: string, paymentId: string) {
  const f = d.funds.find((x) => x.id === fundId);
  const p = f?.payments.find((x) => x.id === paymentId);
  if (!f || !p) return;
  f.payments = f.payments.filter((x) => x.id !== paymentId);
  if (p.txnId) d.txns = d.txns.filter((t) => t.id !== p.txnId);
}

/** Undo a loan — only while nothing was repaid on it. */
export function undoLoan(d: FinanceData, fundId: string, loanId: string): string | null {
  const f = d.funds.find((x) => x.id === fundId);
  const l = f?.loans.find((x) => x.id === loanId);
  if (!f || !l) return null;
  if (f.payments.some((p) => p.loanId === loanId)) return 'برای این وام قسط ثبت شده؛ اول قسط‌ها را بردارید.';
  f.loans = f.loans.filter((x) => x.id !== loanId);
  if (l.txnId) d.txns = d.txns.filter((t) => t.id !== l.txnId);
  return null;
}

/** A transaction made by the fund was deleted from the transaction list: its payment/loan goes too. */
export function forgetFundTxn(d: FinanceData, txnId: string) {
  for (const f of d.funds ?? []) {
    f.payments = f.payments.filter((p) => p.txnId !== txnId);
    for (const l of f.loans) if (l.txnId === txnId) l.txnId = null;
  }
}

/** The user's position: what they put in, what they took, what they still owe — and the fund's account balance it should equal. */
export function myPosition(f: HomeFund): { paidInRial: number; loansRial: number; owedRial: number; netRial: number } | null {
  const m = me(f);
  if (!m) return null;
  const mine = f.payments.filter((p) => p.memberId === m.id);
  const paidInRial = mine.reduce((s, p) => s + p.rial, 0);
  const loansRial = f.loans.filter((l) => l.memberId === m.id).reduce((s, l) => s + l.rial, 0);
  const repaid = mine.filter((p) => p.kind === 'repay').reduce((s, p) => s + p.rial, 0);
  return { paidInRial, loansRial, owedRial: loansRial - repaid, netRial: paidInRial - loansRial };
}
