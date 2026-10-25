// آبان‌تتر in the book (rule 104). The exchange's toman wallet is one of the user's accounts: its balance is what the
// exchange states, read on every wallet refresh (a trade inside the exchange moves it without a book transaction, so it
// is never a «does not agree» question); the coins are assets in «سرمایه‌ها» (assetsFromBalances). Money between a bank
// and the exchange is a transfer — and when the bank's SMS of it is already booked or waiting in the queue, the
// transfer is made from that, never a second copy (the pattern of rules 88 and 100). Pure.
import { addDays } from '../finance/calc';
import { addReported } from '../finance/balance';
import { commitStaged } from '../finance/importers';
import { isMoneyAccount, newId, type Account, type FinanceData, type Iso, type Staged, type Txn } from '../finance/model';
import { assetsFromBalances, isTomanSymbol, type BalanceRow, type CoinRow, type TickerRow } from './parse';

export const ABAN_ACCOUNT_NAME = 'آبان‌تتر (کیف تومانی)';

const tehranIso = (ms: number): Iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const tehranTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

export const abanAccount = (d: FinanceData): Account | null => d.accounts.find((a) => a.exchange === 'aban' && !a.archived) ?? null;

/** the toman balance in a spot wallet answer (IRT is toman at Abantether), or null when the answer had no toman row */
export const tomanBalance = (balances: BalanceRow[]): number | null => {
  const r = balances.find((b) => isTomanSymbol(b.symbol));
  return r ? r.balance : balances.length ? 0 : null;
};

/** Adds the exchange's toman wallet to the accounts, at the balance the exchange states now. */
export function linkAbanAccount(d: FinanceData, irtToman: number, now = Date.now()): Account {
  const prev = abanAccount(d);
  if (prev) return prev;
  const a: Account = { id: newId('a'), name: ABAN_ACCOUNT_NAME, kind: 'wallet', openingRial: 0, openedOn: tehranIso(now), exchange: 'aban' };
  addReported(a, { rial: Math.round(irtToman * 10), date: tehranIso(now), time: tehranTime(now), via: 'exchange' });
  d.accounts.push(a);
  return a;
}

/**
 * A wallet refresh, into the book: the toman balance on the account (a new statement only when it changed, so the log does
 * not fill with the same number) and the coins as assets. Nothing when the wallet is not linked.
 */
export function syncAban(d: FinanceData, spot: BalanceRow[], ticker: TickerRow[], coins: CoinRow[], now = Date.now()): { balanceChanged: boolean; assets: number; skipped: string[] } | null {
  const a = abanAccount(d);
  const irt = tomanBalance(spot);
  if (!a || irt === null) return null;
  const rial = Math.round(irt * 10);
  const balanceChanged = a.reported?.rial !== rial;
  if (balanceChanged) addReported(a, { rial, date: tehranIso(now), time: tehranTime(now), via: 'exchange' });
  const r = assetsFromBalances(d.assets, spot, ticker, () => newId('as'), coins);
  for (const x of r.upsert) {
    const i = d.assets.findIndex((y) => y.id === x.id);
    if (i >= 0) d.assets[i] = x;
    else d.assets.push(x);
  }
  return { balanceChanged, assets: r.upsert.length, skipped: r.skipped };
}

/** 'in' = from a bank into the exchange (a deposit); 'out' = from the exchange to a bank (a withdrawal) */
export type AbanFlow = 'in' | 'out';

/**
 * The bank's record of this money, if it is already here: for a deposit, an expense (the «نوعش چیست؟» answer) from that
 * bank account of the same amount within 2 days, not tied to anything; for a withdrawal, an income to it. Or a queued
 * SMS row of the same amount in that direction (or unstated).
 */
export function abanTransferMatches(d: FinanceData, flow: AbanFlow, bankId: string, amountRial: number, date: Iso): { txns: Txn[]; staged: Staged[] } {
  const amt = Math.round(amountRial);
  const near = (x: Iso | null) => !!x && x >= addDays(date, -2) && x <= addDays(date, 2);
  const kind = flow === 'in' ? 'expense' : 'income';
  const dir = flow === 'in' ? 'out' : 'in';
  return {
    txns: d.txns.filter((t) => t.kind === kind && t.accountId === bankId && t.amountRial === amt && !t.link && near(t.date)).slice(-5),
    staged: d.inbox.filter((s) => s.amountRial === amt && (s.direction === dir || s.direction === null) && near(s.date ?? null) && !s.balanceOnly && (!s.accountId || s.accountId === bankId)).slice(0, 5),
  };
}

export interface AbanTransferInput {
  flow: AbanFlow;
  bankId: string;
  amountRial: number;
  date: Iso;
  time?: string | null;
  /** this is the bank's booked expense/income (abanTransferMatches) */
  linkTxnId?: string | null;
  /** this is the bank's SMS waiting in the queue */
  stagedId?: string | null;
}

export interface AbanTransferReceipt {
  txnId: string;
  how: 'new' | 'linked' | 'staged';
  before?: Txn;
  staged?: Staged;
}

/** Books money between a bank account and the exchange as one transfer. Returns an error message and changes nothing when incomplete. */
export function bookAbanTransfer(d: FinanceData, inp: AbanTransferInput, now = Date.now()): AbanTransferReceipt | string {
  const ex = abanAccount(d);
  if (!ex) return 'اول کیف تومانی آبان‌تتر را به حساب‌ها اضافه کنید.';
  const bank = d.accounts.find((a) => a.id === inp.bankId && isMoneyAccount(a) && a.id !== ex.id);
  if (!bank) return 'کدام حساب بانکی؟';
  const amountRial = Math.round(inp.amountRial);
  if (!(amountRial > 0)) return 'مبلغ را بنویسید.';
  const from = inp.flow === 'in' ? bank.id : ex.id;
  const to = inp.flow === 'in' ? ex.id : bank.id;
  const note = inp.flow === 'in' ? 'واریز به آبان‌تتر' : 'برداشت از آبان‌تتر';
  if (inp.linkTxnId) {
    const t = d.txns.find((x) => x.id === inp.linkTxnId && x.amountRial === amountRial && x.accountId === bank.id && x.kind === (inp.flow === 'in' ? 'expense' : 'income'));
    if (!t) return 'آن تراکنش بانک دیگر با همین مبلغ پیدا نشد.';
    const before = { ...t };
    t.kind = 'transfer';
    t.accountId = from;
    t.toAccountId = to;
    t.categoryId = null;
    t.note = [note, t.note].filter(Boolean).join(' — ').slice(0, 160);
    return { txnId: t.id, how: 'linked', before };
  }
  if (inp.stagedId) {
    const s = d.inbox.find((x) => x.id === inp.stagedId);
    if (!s || s.amountRial !== amountRial) return 'آن پیامک بانک دیگر در صف نیست یا مبلغش فرق دارد.';
    const copy = { ...s };
    const ids = new Set(d.txns.map((t) => t.id));
    const err = commitStaged(d, s.id, { choice: inp.flow === 'in' ? 'transfer-out' : 'transfer-in', accountId: bank.id, otherAccountId: ex.id, date: s.date ?? inp.date });
    if (err) return err;
    const t = d.txns.find((x) => !ids.has(x.id))!;
    t.note = [note, t.note].filter(Boolean).join(' — ').slice(0, 160);
    return { txnId: t.id, how: 'staged', staged: copy };
  }
  const t: Txn = { id: newId('t'), date: inp.date, kind: 'transfer', amountRial, accountId: from, toAccountId: to, note, time: inp.time ?? null, addedAt: now };
  d.txns.push(t);
  return { txnId: t.id, how: 'new' };
}

/** «برگرداندن»: exactly what bookAbanTransfer did, undone */
export function undoAbanTransfer(d: FinanceData, r: AbanTransferReceipt): void {
  if (r.how === 'linked' && r.before) {
    const i = d.txns.findIndex((x) => x.id === r.txnId);
    if (i >= 0) d.txns[i] = r.before;
    return;
  }
  d.txns = d.txns.filter((x) => x.id !== r.txnId);
  if (r.how === 'staged' && r.staged && !d.inbox.some((x) => x.id === r.staged!.id)) d.inbox.push(r.staged);
}
