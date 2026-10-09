// قرض — money lent to or borrowed from a person (rule 84). Not income, not spending: a loan moves money between the
// user's account and a «person» account (kind 'person', one per name), whose balance is the position — positive: they
// owe the user, negative: the user owes them. Net worth counts it as a claim or a debt (isMoneyAccount excludes it).
// The business lends from its own accounts (Account.bizId): such a person account carries the business's id, so the
// loan stays off the owner's personal side (personalSide in calc) and is listed apart — personal and business lending
// are never mixed, and the voice assistant asks which one when it is not said (rule 3: nothing guessed).
import { balances } from './balance';
import { newId, type Account, type FinanceData, type Iso, type Txn } from './model';

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
