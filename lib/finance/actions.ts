import { forgetFundTxn } from './fund';
import { forgetSplitTxn } from './split';
import { forgetBizTxn } from '@/lib/biz/ops';
import { settleLendDue } from './lending';
// Mutations that touch more than one list at once. Kept pure (they mutate a draft passed in) so the
// UI and scripts/finance-test.ts exercise the exact same code.
import { setCurrentBalance } from './balance';
import type { Due } from './calc';
import { accountBalances, monthKey, monthOf } from './calc';
import { newId, type AccountKind, type FinanceData, type Iso, type Loan } from './model';

/**
 * Mark an obligation as settled AND record the money movement, so the account balance and the
 * month's spending agree with what actually happened. Installments settle strictly in order:
 * paying "installment 5" while 4 is open would make the remaining-principal figure wrong.
 */
export function settleDue(d: FinanceData, due: Due, accountId: string, date: Iso, actualRial?: number | null): string | null {
  // what actually came in or went out when it differs from the plan (a salary with overtime, a late fee)
  const amountRial = actualRial != null && Number.isFinite(actualRial) && actualRial > 0 ? Math.round(actualRial) : Math.abs(due.rial);
  if (due.type === 'income') {
    const inc = (d.incomes ?? []).find((x) => x.id === due.refId);
    if (!inc) return 'درآمد پیدا نشد.';
    const mk = due.monthKey ?? (inc.repeat === 'once' ? 'once' : monthKey(monthOf(date)));
    if (!inc.receivedMonths.includes(mk)) inc.receivedMonths.push(mk);
    d.txns.push({ id: newId('t'), date, kind: 'income', amountRial, accountId, categoryId: inc.categoryId ?? 'i-other', note: inc.name, link: { type: 'income', id: inc.id, mk } });
    return null;
  }
  if (due.type === 'loan') {
    const l = d.loans.find((x) => x.id === due.refId);
    if (!l) return 'وام پیدا نشد.';
    if (due.n !== l.paidCount + 1) return 'اقساط به ترتیب تسویه می‌شوند؛ اول قسط قبلی را ثبت کنید.';
    l.paidCount += 1;
    d.txns.push({
      id: newId('t'),
      date,
      kind: l.direction === 'borrowed' ? 'expense' : 'income',
      amountRial,
      accountId,
      categoryId: l.direction === 'borrowed' ? 'c-loan' : 'i-loanback',
      note: `قسط ${(due.n ?? 0).toLocaleString('fa-IR')} — ${l.name}`,
      link: { type: 'loan', id: l.id, n: due.n },
    });
    return null;
  }
  if (due.type === 'cheque') {
    const c = d.cheques.find((x) => x.id === due.refId);
    if (!c) return 'چک پیدا نشد.';
    c.status = 'cleared';
    d.txns.push({
      id: newId('t'),
      date,
      kind: c.direction === 'issued' ? 'expense' : 'income',
      amountRial,
      accountId,
      categoryId: c.direction === 'issued' ? null : 'i-other',
      note: c.direction === 'issued' ? 'پاس شدن چک صادره' : 'وصول چک دریافتی',
      link: { type: 'cheque', id: c.id },
    });
    return null;
  }
  if (due.type === 'lend') return settleLendDue(d, due.refId, accountId, amountRial, date);
  const b = d.bills.find((x) => x.id === due.refId);
  if (!b) return 'قبض پیدا نشد.';
  const mk = due.monthKey ?? monthKey(monthOf(date));
  if (!b.paidMonths.includes(mk)) b.paidMonths.push(mk);
  d.txns.push({ id: newId('t'), date, kind: 'expense', amountRial, accountId, categoryId: b.categoryId, note: b.name, link: { type: 'bill', id: b.id } });
  return null;
}

/**
 * Deleting a transaction that settled an installment / bill / cheque re-opens that obligation —
 * otherwise the loan would show as paid with no payment anywhere in the books.
 */
export function deleteTxn(d: FinanceData, id: string): void {
  const t = d.txns.find((x) => x.id === id);
  if (!t) return;
  d.txns = d.txns.filter((x) => x.id !== id);
  const link = t.link;
  if (!link) return;
  if (link.type === 'loan') {
    const l = d.loans.find((x) => x.id === link.id);
    // only the latest installment can be un-paid without breaking the order
    if (l && link.n === l.paidCount) l.paidCount -= 1;
  } else if (link.type === 'cheque') {
    const c = d.cheques.find((x) => x.id === link.id);
    if (c) c.status = 'pending';
  } else if (link.type === 'income') {
    const inc = (d.incomes ?? []).find((x) => x.id === link.id);
    if (inc) inc.receivedMonths = inc.receivedMonths.filter((m) => m !== link.mk);
  } else if (link.type === 'fund') {
    forgetFundTxn(d, id);
  } else if (link.type === 'split') {
    forgetSplitTxn(d, id);
  } else if (link.type === 'biz') {
    forgetBizTxn(d, t);
  } else if (link.type === 'lend' && link.due) {
    // the repayment that closed a loan carried its date: the loan is open again, and so is its date
    const who = d.accounts.find((x) => x.id === link.id);
    if (who && !who.dueOn) who.dueOn = link.due;
  } else if (link.type === 'bill') {
    const b = d.bills.find((x) => x.id === link.id);
    if (b) {
      const mk = monthKey(monthOf(t.date));
      b.paidMonths = b.paidMonths.filter((m) => m !== mk);
    }
  }
}

/** Remove an account only when nothing points at it; returns an error message otherwise. */
export function deleteAccount(d: FinanceData, id: string): string | null {
  if (d.txns.some((t) => t.accountId === id || t.toAccountId === id)) return 'این حساب تراکنش دارد؛ به‌جای حذف، آن را بایگانی کنید.';
  d.accounts = d.accounts.filter((a) => a.id !== id);
  return null;
}

/**
 * Edits an account. A new current balance moves only the opening balance, so every transaction
 * stays as recorded and the book shows exactly the balance the user typed.
 */
export function editAccount(d: FinanceData, id: string, patch: { name?: string; kind?: AccountKind; openedOn?: Iso; currentRial?: number | null }, now = Date.now()): string | null {
  const a = d.accounts.find((x) => x.id === id);
  if (!a) return 'حساب پیدا نشد.';
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return 'نام حساب خالی است.';
    a.name = patch.name.trim();
  }
  if (patch.kind) a.kind = patch.kind;
  if (patch.openedOn && /^\d{4}-\d{2}-\d{2}$/.test(patch.openedOn)) a.openedOn = patch.openedOn;
  if (patch.currentRial != null) {
    if (!Number.isFinite(patch.currentRial)) return 'موجودی نامعتبر است.';
    // an account the bank reports on: «موجودی الان» is a statement at this moment (rule 76); otherwise the opening moves
    if (a.reported) setCurrentBalance(d, id, patch.currentRial, now);
    else a.openingRial += Math.round(patch.currentRial) - (accountBalances(d)[id] ?? 0);
  }
  return null;
}

/**
 * Edits a loan. Installments already paid stay paid — their transactions are in the book — so the
 * loan cannot be shortened below them; the remaining schedule follows the new terms.
 */
export function editLoan(d: FinanceData, id: string, next: Omit<Loan, 'id'>): string | null {
  const l = d.loans.find((x) => x.id === id);
  if (!l) return 'وام پیدا نشد.';
  if (!next.name.trim()) return 'عنوان را بنویسید.';
  if (!(next.principalRial > 0) || !(next.months >= 1) || !(next.annualRatePct >= 0) || !Number.isInteger(next.months)) return 'مبلغ، نرخ و تعداد اقساط را درست وارد کنید.';
  if (!Number.isInteger(next.paidCount) || next.paidCount < 0 || next.paidCount > next.months) return 'تعداد اقساط پرداخت‌شده نامعتبر است.';
  const booked = Math.max(0, ...d.txns.filter((t) => t.link?.type === 'loan' && t.link.id === id).map((t) => t.link!.n ?? 0));
  if (next.paidCount < booked) return `قسط ${booked.toLocaleString('fa-IR')} در دفتر ثبت شده؛ برای کم کردن اقساط پرداخت‌شده، اول تراکنش آن قسط را حذف کنید.`;
  if (next.direction !== l.direction && booked) return 'برای این وام قسط ثبت شده؛ نوع (بدهی/طلب) را نمی‌شود عوض کرد.';
  Object.assign(l, { ...next, name: next.name.trim() });
  return null;
}

/** CSV for Excel / Power BI. Amounts in toman, dates both Gregorian and Jalali. BOM so Excel reads UTF-8. */
export function txnsCsv(d: FinanceData, jalali: (iso: string) => string): string {
  const acc = new Map(d.accounts.map((a) => [a.id, a.name]));
  const cat = new Map(d.categories.map((c) => [c.id, c.name]));
  const kind = { expense: 'هزینه', income: 'درآمد', transfer: 'انتقال' } as const;
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [...d.txns]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) =>
      [t.date, jalali(t.date), kind[t.kind], Math.round(t.amountRial / 10), acc.get(t.accountId) ?? '', t.toAccountId ? acc.get(t.toAccountId) ?? '' : '', t.categoryId ? cat.get(t.categoryId) ?? '' : '', t.note ?? '']
        .map((v) => (typeof v === 'number' ? String(v) : q(v)))
        .join(','),
    );
  return '﻿' + ['date,jalali_date,kind,amount_toman,account,to_account,category,note', ...rows].join('\n');
}
