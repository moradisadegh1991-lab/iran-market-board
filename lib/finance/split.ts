// دنگ — shared expenses (CLAUDE.md rule 78). Pure: everything takes the book and changes it.
//
// A group (a trip, a shared flat, friends) records who paid for what and each member's part. From that:
// everyone's net (+ the group owes them, − they owe the group), and the fewest transfers that settle it.
//
// The user's own money moves in their book through one account per group (kind 'split'), whose balance is
// their net in the group:
//   • they paid A, their part s  → expense s (their real spending) + transfer A−s into the group account
//                                   (money others owe them); the bank sees A leave, as it did
//   • someone else paid, part s  → expense s from the group account (they now owe it)
//   • a settlement               → transfer between their account and the group account
// So spending counts only the user's part, net worth counts what friends owe, and nothing is counted twice.
// When the bank SMS for that payment is already booked, the expense is linked to it (it becomes the user's
// part) instead of booking the money a second time.
import { newId, type FinanceData, type Iso, type SplitExpense, type SplitGroup, type SplitShare, type Txn } from './model';

/**
 * Splits an amount exactly: equal parts or by weights, in whole toman where possible; the remainder goes one
 * toman at a time to the first members (largest remainders first for weights). Always sums to `amount`.
 */
export function splitAmount(amount: number, memberIds: string[], weights?: number[]): SplitShare[] {
  const n = memberIds.length;
  if (!n) return [];
  const w = weights && weights.length === n ? weights.map((x) => Math.max(0, x)) : memberIds.map(() => 1);
  const total = w.reduce((s, x) => s + x, 0) || n;
  const toman = Math.floor(amount / 10);
  const raw = w.map((x) => (toman * x) / total);
  const base = raw.map((x) => Math.floor(x));
  let left = toman - base.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) base[order[k % n].i]++;
  const shares = memberIds.map((id, i) => ({ memberId: id, rial: base[i] * 10 }));
  shares[0].rial += amount - toman * 10; // the rial under one toman
  return shares;
}

/** Each member's net: what they paid (and sent in settlements) minus their parts (and what they received). */
export function netOf(g: SplitGroup): Record<string, number> {
  const net: Record<string, number> = {};
  for (const m of g.members) net[m.id] = 0;
  for (const e of g.expenses) {
    net[e.paidBy] = (net[e.paidBy] ?? 0) + e.amountRial;
    for (const s of e.shares) net[s.memberId] = (net[s.memberId] ?? 0) - s.rial;
  }
  for (const s of g.settlements) {
    net[s.from] = (net[s.from] ?? 0) + s.rial;
    net[s.to] = (net[s.to] ?? 0) - s.rial;
  }
  return net;
}

/** The fewest transfers that settle everyone: the largest debtor pays the largest creditor, repeatedly (at most n−1). */
export function settleUp(g: SplitGroup): { from: string; to: string; rial: number }[] {
  const net = netOf(g);
  const cred = Object.entries(net).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const debt = Object.entries(net).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const out: { from: string; to: string; rial: number }[] = [];
  while (cred.length && debt.length) {
    cred.sort((a, b) => b.v - a.v);
    debt.sort((a, b) => b.v - a.v);
    const c = cred[0];
    const d = debt[0];
    const x = Math.min(c.v, d.v);
    out.push({ from: d.id, to: c.id, rial: x });
    c.v -= x;
    d.v -= x;
    if (!c.v) cred.shift();
    if (!d.v) debt.shift();
  }
  return out;
}

export function createGroup(d: FinanceData, name: string, members: { name: string; me?: boolean }[], today: Iso): string | string[] {
  const errs: string[] = [];
  if (!name.trim()) errs.push('نام گروه را بنویسید.');
  const ms = members.filter((m) => m.name.trim());
  if (ms.length < 2) errs.push('دست‌کم دو نفر لازم است.');
  if (ms.filter((m) => m.me).length > 1) errs.push('فقط یک نفر «من» است.');
  if (errs.length) return errs;
  const g: SplitGroup = { id: newId('g'), name: name.trim(), members: ms.map((m) => ({ id: newId('m'), name: m.name.trim(), ...(m.me ? { me: true } : {}) })), expenses: [], settlements: [], accountId: null };
  if (g.members.some((m) => m.me)) {
    const id = newId('a');
    d.accounts.push({ id, name: `دنگ: ${g.name}`, kind: 'split', openingRial: 0, openedOn: today });
    g.accountId = id;
  }
  (d.splitGroups ??= []).push(g);
  return g.id;
}

export interface NewExpense {
  date: Iso;
  title: string;
  amountRial: number;
  paidBy: string;
  mode: SplitExpense['mode'];
  /** who shares it (equal/shares) */
  among: string[];
  /** shares mode: weights in `among` order; exact mode: rial per member in `among` order */
  values?: number[];
  categoryId?: string | null;
}
export interface Ledger {
  /** the user paid: from which account */
  accountId?: string | null;
  /** the user paid and the bank SMS for it is already booked: turn that transaction into the user's part */
  linkTxnId?: string | null;
}

/** Adds an expense; returns its id, or the problems. */
export function addExpense(d: FinanceData, groupId: string, x: NewExpense, ledger: Ledger = {}): string | string[] {
  const g = d.splitGroups.find((y) => y.id === groupId);
  if (!g) return ['گروه پیدا نشد.'];
  const errs: string[] = [];
  const amount = Math.round(x.amountRial);
  if (!(amount > 0)) errs.push('مبلغ را بنویسید.');
  if (!g.members.some((m) => m.id === x.paidBy)) errs.push('چه کسی پرداخت کرد؟');
  const among = x.among.filter((id) => g.members.some((m) => m.id === id));
  if (!among.length) errs.push('دست‌کم یک نفر باید سهم داشته باشد.');
  let shares: SplitShare[] = [];
  if (!errs.length) {
    if (x.mode === 'exact') {
      const v = (x.values ?? []).map((n) => Math.round(n || 0));
      shares = among.map((id, i) => ({ memberId: id, rial: v[i] ?? 0 }));
      const sum = shares.reduce((s, y) => s + y.rial, 0);
      if (sum !== amount) errs.push(`جمع سهم‌ها (${Math.round(sum / 10).toLocaleString('fa-IR')} تومان) با مبلغ (${Math.round(amount / 10).toLocaleString('fa-IR')} تومان) برابر نیست.`);
    } else shares = splitAmount(amount, among, x.mode === 'shares' ? x.values : undefined);
  }
  if (errs.length) return errs;
  const e: SplitExpense = {
    id: newId('e'),
    date: x.date,
    title: x.title.trim() || 'خرج',
    amountRial: amount,
    paidBy: x.paidBy,
    mode: x.mode,
    shares: shares.filter((s) => s.rial > 0),
    categoryId: x.categoryId ?? null,
    ledger: null,
  };
  bookExpense(d, g, e, ledger);
  g.expenses.push(e);
  return e.id;
}

function bookExpense(d: FinanceData, g: SplitGroup, e: SplitExpense, ledger: Ledger) {
  const me = g.members.find((m) => m.me);
  if (!me || !g.accountId) return;
  const part = e.shares.find((s) => s.memberId === me.id)?.rial ?? 0;
  const note = `دنگ ${g.name}: ${e.title}`;
  const link = { type: 'split' as const, id: g.id };
  const ids: string[] = [];
  const push = (t: Omit<Txn, 'id'>) => {
    const id = newId('t');
    d.txns.push({ id, ...t });
    ids.push(id);
  };
  let linked: { id: string; before: Txn } | null = null;
  if (e.paidBy === me.id) {
    const t = ledger.linkTxnId ? d.txns.find((y) => y.id === ledger.linkTxnId && y.kind === 'expense' && y.amountRial === e.amountRial) : undefined;
    const from = t?.accountId ?? ledger.accountId;
    if (!from) return;
    if (t) {
      linked = { id: t.id, before: { ...t } };
      if (part > 0) {
        t.amountRial = part;
        t.categoryId = e.categoryId ?? t.categoryId;
        t.note = t.note ? `${t.note} (سهم من از دنگ ${g.name})` : `${note} — سهم من`;
      } else {
        // the user paid for others only: the whole payment is owed to them
        t.kind = 'transfer';
        t.toAccountId = g.accountId;
        t.categoryId = null;
        t.note = note;
      }
    } else if (part > 0) push({ date: e.date, kind: 'expense', amountRial: part, accountId: from, categoryId: e.categoryId ?? 'c-other', note: `${note} — سهم من`, link });
    const rest = e.amountRial - part;
    if (rest > 0 && !(t && part === 0)) push({ date: e.date, time: t?.time ?? null, kind: 'transfer', amountRial: rest, accountId: from, toAccountId: g.accountId, note: `${note} — سهم بقیه`, link });
  } else if (part > 0) {
    push({ date: e.date, kind: 'expense', amountRial: part, accountId: g.accountId, categoryId: e.categoryId ?? 'c-other', note: `${note} — سهم من (پرداخت: ${g.members.find((m) => m.id === e.paidBy)?.name ?? ''})`, link });
  }
  e.ledger = { txnIds: ids, linked };
}

/** Removes an expense, its transactions, and gives a linked SMS transaction back its own amount. */
export function deleteExpense(d: FinanceData, groupId: string, expenseId: string) {
  const g = d.splitGroups.find((y) => y.id === groupId);
  const e = g?.expenses.find((x) => x.id === expenseId);
  if (!g || !e) return;
  g.expenses = g.expenses.filter((x) => x.id !== expenseId);
  if (!e.ledger) return;
  d.txns = d.txns.filter((t) => !e.ledger!.txnIds.includes(t.id));
  const L = e.ledger.linked;
  if (L) {
    const i = d.txns.findIndex((t) => t.id === L.id);
    if (i >= 0) d.txns[i] = { ...L.before };
  }
}

/** A settlement between two members; when the user is one of them, the money moves through `accountId`. */
export function settle(d: FinanceData, groupId: string, from: string, to: string, rial: number, date: Iso, accountId?: string | null): string | null {
  const g = d.splitGroups.find((y) => y.id === groupId);
  if (!g) return 'گروه پیدا نشد.';
  if (from === to || !g.members.some((m) => m.id === from) || !g.members.some((m) => m.id === to)) return 'پرداخت‌کننده و گیرنده را انتخاب کنید.';
  if (!(rial > 0)) return 'مبلغ را بنویسید.';
  const s = { id: newId('s'), date, from, to, rial: Math.round(rial), txnId: null as string | null };
  const me = g.members.find((m) => m.me);
  if (me && g.accountId && accountId && (from === me.id || to === me.id)) {
    const id = newId('t');
    const other = g.members.find((m) => m.id === (from === me.id ? to : from))?.name ?? '';
    d.txns.push({
      id,
      date,
      kind: 'transfer',
      amountRial: s.rial,
      accountId: from === me.id ? accountId : g.accountId,
      toAccountId: from === me.id ? g.accountId : accountId,
      note: `دنگ ${g.name}: تسویه ${from === me.id ? 'با' : 'از'} ${other}`,
      link: { type: 'split', id: g.id },
    });
    s.txnId = id;
  }
  g.settlements.push(s);
  return null;
}

export function undoSettlement(d: FinanceData, groupId: string, id: string) {
  const g = d.splitGroups.find((y) => y.id === groupId);
  const s = g?.settlements.find((x) => x.id === id);
  if (!g || !s) return;
  g.settlements = g.settlements.filter((x) => x.id !== id);
  if (s.txnId) d.txns = d.txns.filter((t) => t.id !== s.txnId);
}

/** A transaction made by a group was deleted from the transaction list: forget it there (the group's own record stays). */
export function forgetSplitTxn(d: FinanceData, txnId: string) {
  for (const g of d.splitGroups ?? []) {
    for (const e of g.expenses) if (e.ledger) e.ledger.txnIds = e.ledger.txnIds.filter((x) => x !== txnId);
    for (const s of g.settlements) if (s.txnId === txnId) s.txnId = null;
  }
}

/** Recent expenses from the user's book that could be this group payment (same amount, ±3 days): the SMS already booked. */
export function linkCandidates(d: FinanceData, amountRial: number, date: Iso): Txn[] {
  const ms = (x: Iso) => Date.parse(`${x}T00:00:00Z`);
  return d.txns
    .filter((t) => t.kind === 'expense' && t.amountRial === Math.round(amountRial) && Math.abs(ms(t.date) - ms(date)) <= 3 * 86_400_000 && t.link?.type !== 'split')
    .slice(-5);
}
