// A loan and the bank's SMS of the same money, booked once (rule 88) — by voice (voice-lend.ts) or in the form (TxnForm).
// The SMS may be a queued row («ورود از بانک») or already booked as spending/income (the phone's «نوعش چیست؟» answer);
// the loan takes it over. An SMS still on its way is matched when it arrives (lending.attachSmsToLend, in queueSms).
import { deleteTxn } from './actions';
import { bookLend, type LendInput, type LendSms } from './lending';
import type { FinanceData, Staged, Txn } from './model';
import { learnFromCommit } from './sources';

/** what «برگرداندن» puts back: the queued SMS row, or the SMS's transaction as it was before it became the loan */
export type LendUndo = { txnId: string; row?: Staged | null; restore?: Txn | null };

export function bookLendWithSms(d: FinanceData, p: LendInput, sms: LendSms | null): LendUndo | string {
  const row = sms?.kind === 'queued' ? d.inbox.find((x) => x.id === sms.id) ?? null : null;
  const old = sms?.kind === 'booked' ? d.txns.find((x) => x.id === sms.id && !x.link) ?? null : null;
  // the loan happened when the bank says it did, so the balance in that SMS already includes it (rule 76)
  const t = bookLend(d, { ...p, date: row?.date ?? old?.date ?? p.date });
  if (typeof t === 'string') return t;
  if (row) {
    Object.assign(t, { src: row.source, ref: row.ref ?? null, time: row.time ?? null, ...(row.smsKey ? { smsKey: row.smsKey, smsAt: row.at ?? null } : {}) });
    d.inbox = d.inbox.filter((x) => x.id !== row.id);
    learnFromCommit(d, row, p.accountId); // its card now knows its account
    return { txnId: t.id, row };
  }
  if (old) {
    // booked as spending/income from the phone's question: that transaction becomes the loan, not a second one
    Object.assign(t, { src: old.src, ref: old.ref ?? null, time: old.time ?? null, smsKey: old.smsKey, smsAt: old.smsAt ?? null, ...(old.addedAt ? { addedAt: old.addedAt } : {}) });
    d.txns = d.txns.filter((x) => x.id !== old.id);
    return { txnId: t.id, restore: { ...old } };
  }
  return { txnId: t.id };
}

export function undoLendWithSms(d: FinanceData, u: LendUndo): void {
  deleteTxn(d, u.txnId);
  if (u.row) d.inbox.push(u.row);
  if (u.restore) d.txns.push(u.restore);
}
