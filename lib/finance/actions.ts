// Mutations that touch more than one list at once. Kept pure (they mutate a draft passed in) so the
// UI and scripts/finance-test.ts exercise the exact same code.
import type { Due } from './calc';
import { monthKey, monthOf } from './calc';
import { newId, type FinanceData, type Iso } from './model';

/**
 * Mark an obligation as settled AND record the money movement, so the account balance and the
 * month's spending agree with what actually happened. Installments settle strictly in order:
 * paying "installment 5" while 4 is open would make the remaining-principal figure wrong.
 */
export function settleDue(d: FinanceData, due: Due, accountId: string, date: Iso): string | null {
  const amountRial = Math.abs(due.rial);
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
