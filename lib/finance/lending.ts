// قرض — money lent to or borrowed from a person (rule 84). Not income, not spending: a loan moves money between the
// user's account and a «person» account (kind 'person', one per name), whose balance is the position — positive: they
// owe the user, negative: the user owes them. Net worth counts it as a claim or a debt (isMoneyAccount excludes it).
// The business lends from its own accounts (Account.bizId): such a person account carries the business's id, so the
// loan stays off the owner's personal side (personalSide in calc) and is listed apart — personal and business lending
// are never mixed, and the voice assistant asks which one when it is not said (rule 3: nothing guessed).
import { balances } from './balance';
import { newId, type Account, type FinanceData, type Iso, type Staged, type Txn } from './model';

export type LendKind = 'lend' | 'borrow' | 'repaid' | 'repay';
/** lend: I gave a loan · borrow: I took a loan · repaid: they paid me back · repay: I paid them back */
export const LEND_LABEL: Record<LendKind, string> = { lend: 'قرض دادم', borrow: 'قرض گرفتم', repaid: 'قرضش را پس داد', repay: 'قرضم را پس دادم' };

const norm = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ').trim();
export const isPerson = (a: Pick<Account, 'kind'>) => a.kind === 'person';

/** the people the user (or the business, with bizId) has lent to or borrowed from */
export function people(d: FinanceData, bizId: string | null = null): Account[] {
  return d.accounts.filter((a) => isPerson(a) && !a.archived && (a.bizId ?? null) === bizId);
}

/** the person's account, made on first use; a name is matched without regard to ی/ي, ک/ك or spacing */
export function personAccount(d: FinanceData, name: string, bizId: string | null, today: Iso): Account {
  const n = norm(name);
  const hit = people(d, bizId).find((a) => norm(a.name) === n);
  if (hit) return hit;
  const a: Account = { id: newId('p'), name: n, kind: 'person', openingRial: 0, openedOn: today, ...(bizId ? { bizId } : {}) };
  d.accounts.push(a);
  return a;
}

/**
 * The business is removed: its accounts become personal (SettingsView). A person the business lent to becomes the
 * user's own — merged into the personal account of the same name when there is one, so one name is one position.
 */
export function detachBusinessAccounts(d: FinanceData, bizId: string): void {
  for (const a of d.accounts) {
    if (a.bizId !== bizId) continue;
    a.bizId = null;
    if (!isPerson(a)) continue;
    const same = d.accounts.find((x) => x !== a && isPerson(x) && !x.bizId && !x.archived && norm(x.name) === norm(a.name));
    if (!same) continue;
    for (const t of d.txns) {
      if (t.accountId === a.id) t.accountId = same.id;
      if (t.toAccountId === a.id) t.toAccountId = same.id;
      if (t.link?.type === 'lend' && t.link.id === a.id) t.link = { ...t.link, id: same.id };
    }
    same.openingRial += a.openingRial;
    a.archived = true;
  }
  d.accounts = d.accounts.filter((a) => !(a.archived && isPerson(a) && !d.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id)));
}

export interface LendInput {
  kind: LendKind;
  person: string;
  /** the user's (or the business's) own account the money left or came into */
  accountId: string;
  amountRial: number;
  date: Iso;
  note?: string;
}

/** Books the loan or the repayment. Returns the transaction or why it cannot. */
export function bookLend(d: FinanceData, p: LendInput): Txn | string {
  const acc = d.accounts.find((a) => a.id === p.accountId && !a.archived);
  if (!acc || isPerson(acc)) return 'حساب را انتخاب کنید.';
  if (!p.person.trim()) return 'نام طرف قرض را بنویسید.';
  if (!(p.amountRial > 0)) return 'مبلغ را وارد کنید.';
  const who = personAccount(d, p.person, acc.bizId ?? null, p.date);
  // money leaves the user: lend, repay; money comes in: borrow, repaid
  const out = p.kind === 'lend' || p.kind === 'repay';
  const t: Txn = {
    id: newId('t'),
    date: p.date,
    kind: 'transfer',
    amountRial: Math.round(p.amountRial),
    accountId: out ? acc.id : who.id,
    toAccountId: out ? who.id : acc.id,
    categoryId: null,
    note: p.note?.trim() || LEND_LABEL[p.kind],
    link: { type: 'lend', id: who.id, mk: p.kind },
  };
  d.txns.push(t);
  return t;
}

export interface PersonPosition {
  account: Account;
  /** + they owe the user, − the user owes them */
  balanceRial: number;
  lastDate: Iso | null;
  /** every loan and repayment with this person, newest first */
  txns: Txn[];
  business: boolean;
}

export function positions(d: FinanceData): PersonPosition[] {
  const bal = balances(d);
  return d.accounts
    .filter((a) => isPerson(a) && !a.archived)
    .map((a) => {
      const txns = d.txns.filter((t) => t.accountId === a.id || t.toAccountId === a.id).sort((x, y) => (x.date < y.date ? 1 : -1));
      return { account: a, balanceRial: bal[a.id] ?? 0, lastDate: txns[0]?.date ?? null, txns, business: !!a.bizId };
    })
    .sort((x, y) => Math.abs(y.balanceRial) - Math.abs(x.balanceRial));
}

/** who owes the user and whom the user owes, personal and business apart */
export function lendingSummary(d: FinanceData, business = false) {
  const ps = positions(d).filter((p) => p.business === business);
  return {
    owedToMe: ps.filter((p) => p.balanceRial > 0),
    iOwe: ps.filter((p) => p.balanceRial < 0),
    owedToMeRial: ps.reduce((s, p) => s + Math.max(0, p.balanceRial), 0),
    iOweRial: ps.reduce((s, p) => s + Math.max(0, -p.balanceRial), 0),
  };
}

// ── the bank's SMS of a loan (rule 88) ─────────────────────────────────────────────────────────────────────────────
// A loan told by voice and the bank's SMS of the same money are one event. The SMS may be waiting in the queue, already
// booked as spending/income (the phone's «نوعش چیست؟» answer), or still on its way. Either way it is booked once.

export interface LendSms {
  /** queued: a row in «ورود از بانک»; booked: a transaction from an SMS that is not yet anything but spending/income */
  kind: 'queued' | 'booked';
  id: string;
  amountRial: number;
  accountId: string | null;
  date: Iso;
  time: string | null;
  /** the bank or sender, for «همون پیامک ملت ساعت ۱۰:۱۲» */
  bank: string | null;
}
const dirOf = (k: LendKind): 'out' | 'in' => (k === 'lend' || k === 'repay' ? 'out' : 'in');
const daysApart = (a: Iso, b: Iso) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * SMS that could be this loan's money: the same direction, within `days` before today, the amount when known, the account
 * when known — a row whose card is not linked yet only when its bank fits the account's name — and never the other side
 * (a personal loan never takes the shop card's SMS, nor the other way round). Newest first.
 */
export function lendSmsCandidates(
  d: FinanceData,
  p: { kind: LendKind; amountRial?: number | null; accountId?: string | null; side?: 'me' | 'biz' | null; today: Iso; days?: number },
): LendSms[] {
  const dir = dirOf(p.kind);
  const days = p.days ?? 3;
  const want = p.accountId ? d.accounts.find((a) => a.id === p.accountId) ?? null : null;
  const fits = (accountId: string | null, bank: string | null, date: Iso | null, amountRial: number) => {
    if (!date) return false;
    const ago = daysApart(p.today, date);
    if (ago < 0 || ago > days) return false;
    if (p.amountRial && amountRial !== p.amountRial) return false;
    const acc = accountId ? d.accounts.find((a) => a.id === accountId) : null;
    if (acc) {
      if (want && acc.id !== want.id) return false;
      if (p.side && !!acc.bizId !== (p.side === 'biz')) return false;
      return true;
    }
    // a card not linked to an account yet: only with an amount, and a bank that fits the account said
    if (!p.amountRial) return false;
    if (want && bank && !norm(want.name).includes(norm(bank).replace(/^بانک /, ''))) return false;
    return true;
  };
  const out: LendSms[] = [];
  for (const r of d.inbox) {
    if (r.source === 'classic' || (r.direction && r.direction !== dir)) continue;
    if (fits(r.accountId ?? null, r.bank ?? null, r.date, r.amountRial)) out.push({ kind: 'queued', id: r.id, amountRial: r.amountRial, accountId: r.accountId ?? null, date: r.date!, time: r.time ?? null, bank: r.bank ?? null });
  }
  for (const t of d.txns) {
    if (!t.smsKey || t.link || t.kind !== (dir === 'out' ? 'expense' : 'income')) continue;
    if (fits(t.accountId, null, t.date, t.amountRial)) out.push({ kind: 'booked', id: t.id, amountRial: t.amountRial, accountId: t.accountId, date: t.date, time: t.time ?? null, bank: null });
  }
  return out.sort((a, b) => (a.date === b.date ? (b.time ?? '').localeCompare(a.time ?? '') : b.date.localeCompare(a.date)));
}

/**
 * A bank SMS that arrives after the loan was told (by voice or typed): it is that loan's SMS, not a new transaction.
 * The loan takes the SMS's day and time, so the balance the bank reports in it already includes the loan (rule 76).
 */
export function attachSmsToLend(d: FinanceData, r: Pick<Staged, 'accountId' | 'date' | 'time' | 'direction' | 'amountRial' | 'smsKey' | 'at' | 'ref'>): Txn | null {
  if (!r.accountId || !r.date || !r.direction || !r.smsKey) return null;
  const t = d.txns.find(
    (x) =>
      x.link?.type === 'lend' &&
      !x.smsKey &&
      x.amountRial === r.amountRial &&
      (r.direction === 'out' ? x.accountId === r.accountId : x.toAccountId === r.accountId) &&
      Math.abs(daysApart(x.date, r.date!)) <= 2,
  );
  if (!t) return null;
  Object.assign(t, { date: r.date, time: r.time ?? t.time ?? null, smsKey: r.smsKey, smsAt: r.at ?? null, src: 'sms' as const, ref: r.ref ?? t.ref ?? null });
  return t;
}
