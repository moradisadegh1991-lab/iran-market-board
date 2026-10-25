// Cards and bank accounts found in SMS, and the balance the bank states — the pure half.
//
// Bank SMS name a card (…4417) or an account number and usually end with «مانده: …». From those
// the app learns which cards/accounts exist and what the bank says is in them, without the user
// typing anything. Two rules keep it honest:
//  • a card/account becomes one of the user's accounts only when the user links it (or creates an
//    account for it) — the app never guesses which account an unknown card belongs to;
//  • the bank-stated balance is what the account's balance is built on (balance.ts, rule 76); when the
//    book disagrees with it, the user is asked why (monthCheck), the app does not pick a reason.
import { attachSmsToLend } from './lending';
import { addReported } from './balance';
import { enqueue, wasDismissed, type SmsApi, type SmsResult } from './importers';
import { newId, type Account, type BalanceSms, type FinanceData, type Iso, type SmsSource, type Staged, type Txn } from './model';

const TEHRAN = '+03:30'; // Iran has had no DST since 2022

/** ms of a staged row: the inbox receive time, else its date + time read as Tehran time. */
export function stagedAt(s: Pick<Staged, 'at' | 'date' | 'time'>): number | null {
  if (typeof s.at === 'number' && Number.isFinite(s.at)) return s.at;
  if (!s.date) return null;
  const t = /^\d{1,2}:\d{2}$/.test(s.time ?? '') ? s.time!.padStart(5, '0') : '23:59';
  const ms = Date.parse(`${s.date}T${t}:00${TEHRAN}`);
  return Number.isFinite(ms) ? ms : null;
}
const tehranIso = (ms: number): Iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const tehranTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** The source keys a row mentions: its card and/or its account number. */
export function sourceKeys(s: Pick<Staged, 'card' | 'accountNo'>): string[] {
  const out: string[] = [];
  if (s.card && /^\d{4}$/.test(s.card)) out.push(`card:${s.card}`);
  if (s.accountNo && /^\d{6,}$/.test(s.accountNo)) out.push(`acc:${s.accountNo}`);
  return out;
}

export function sourceLabel(src: Pick<SmsSource, 'kind' | 'ref' | 'bank'>): string {
  // isolated left-to-right, or «••4417» shows as «4417••» inside Persian text
  const ltr = (t: string) => `\u2066${t}\u2069`;
  const base = src.kind === 'card' ? `کارت ${ltr(`••${src.ref}`)}` : `حساب ${ltr(src.ref.length > 6 ? `…${src.ref.slice(-6)}` : src.ref)}`;
  return src.bank && !/^\+?\d+$/.test(src.bank) ? `${base} · ${src.bank}` : base;
}

/** Keeps the newest bank-stated balance on an account. */
export function reportBalance(d: FinanceData, accountId: string, rial: number, at: number, via: 'sms' | 'statement') {
  const a = d.accounts.find((x) => x.id === accountId);
  if (!a || !Number.isFinite(rial)) return;
  addReported(a, { rial: Math.round(rial), date: tehranIso(at), time: tehranTime(at), via });
}

/**
 * Learns from freshly read rows: new cards/accounts, their latest stated balance, and — when a
 * card is already linked — fills in the row's account and the account's bank balance.
 * Returns how many cards/accounts were seen for the first time.
 */
export function learnSources(d: FinanceData, rows: Staged[], now: number): number {
  d.smsSources ??= [];
  const queued = new Set(d.inbox.map((x) => x.id));
  let fresh = 0;
  for (const r of rows) {
    if (queued.has(r.id)) continue; // already learned when it was first queued
    const at = stagedAt(r) ?? now;
    for (const key of sourceKeys(r)) {
      let src = d.smsSources.find((x) => x.key === key);
      if (!src) {
        const [kind, ref] = key.split(':') as ['card' | 'acc', string];
        src = { key, kind: kind === 'card' ? 'card' : 'account', ref, bank: null, accountId: null, count: 0, firstAt: at, lastAt: at, lastBalanceRial: null, lastBalanceAt: null };
        d.smsSources.push(src);
        fresh++;
      }
      src.count++;
      src.firstAt = Math.min(src.firstAt, at);
      src.lastAt = Math.max(src.lastAt, at);
      if (r.bank && (!src.bank || !/^\+?\d+$/.test(r.bank))) src.bank = r.bank;
      if (typeof r.balanceRial === 'number' && (src.lastBalanceAt === null || at >= src.lastBalanceAt)) {
        src.lastBalanceRial = r.balanceRial;
        src.lastBalanceAt = at;
      }
      if (src.accountId && d.accounts.some((a) => a.id === src!.accountId)) {
        if (!r.accountId) r.accountId = src.accountId;
        if (typeof r.balanceRial === 'number') reportBalance(d, src.accountId, r.balanceRial, at, 'sms');
      }
    }
  }
  return fresh;
}

const SAME_SMS_MS = 5 * 60_000;

/**
 * The same SMS seen twice: once by the notification that asked about it as it arrived, once in the
 * inbox read (receive times a few seconds apart) — or read again after it was booked.
 */
export function sameSms(a: { smsKey?: string; at?: number | null; date?: Iso | null }, b: { smsKey?: string; at?: number | null; date?: Iso | null }): boolean {
  if (!a.smsKey || a.smsKey !== b.smsKey) return false;
  if (typeof a.at === 'number' && typeof b.at === 'number') return Math.abs(a.at - b.at) <= SAME_SMS_MS;
  return !!a.date && a.date === b.date;
}

/** The queued or booked SMS row this message already is, if any. */
export function seenSms(d: FinanceData, r: Pick<Staged, 'smsKey' | 'at' | 'date'>): { queued?: Staged; booked?: Txn } | null {
  if (!r.smsKey) return null;
  const queued = d.inbox.find((x) => sameSms(x, r));
  if (queued) return { queued };
  const booked = d.txns.find((t) => sameSms({ smsKey: t.smsKey, at: t.smsAt, date: t.date }, r));
  return booked ? { booked } : null;
}

/**
 * SMS rows into the queue: learn the cards first so rows of a linked card arrive with their account.
 * An SMS the user ignored before never comes back (rule 99); a balance-only row goes to noteBalanceSms.
 */
export function queueSms(d: FinanceData, rows: Staged[], now: number): { added: number; newSources: number } {
  const bal = rows.filter((r) => r.balanceOnly);
  const fresh = rows.filter((r) => !r.balanceOnly && !seenSms(d, r) && !wasDismissed(d, r));
  if (bal.length) noteBalanceSms(d, bal, now);
  const newSources = learnSources(d, fresh, now);
  // the SMS of a loan already told by voice or typed is that loan's, not a new row (rule 88)
  return { added: enqueue(d, fresh.filter((r) => !attachSmsToLend(d, r))), newSources };
}

/** how many balance-only SMS are kept (the oldest go) */
export const MAX_BALANCE_SMS = 300;

/**
 * Balance-only SMS («مانده حساب: …»): kept in their own list, never in the queue (rule 99). The card or
 * account they name learns the balance, and a linked one passes it to its account (rule 76). One with no
 * card/account number cannot be placed: the app does not guess which account it is (rule 45).
 * Returns how many were new.
 */
export function noteBalanceSms(d: FinanceData, rows: Staged[], now: number): number {
  d.balanceSms ??= [];
  const fresh = rows.filter((r) => r.balanceOnly && typeof r.balanceRial === 'number' && r.smsKey && !d.balanceSms!.some((x) => sameSms(x, r)));
  if (!fresh.length) return 0;
  learnSources(d, fresh, now);
  for (const r of fresh)
    d.balanceSms.push({
      id: r.id, smsKey: r.smsKey!, at: r.at ?? null, date: r.date, time: r.time ?? null, balanceRial: r.balanceRial!,
      card: r.card ?? null, accountNo: r.accountNo ?? null, bank: r.bank ?? null, raw: r.raw, importedAt: now,
    });
  d.balanceSms.sort((a, b) => (stagedAt(a) ?? a.importedAt) - (stagedAt(b) ?? b.importedAt));
  if (d.balanceSms.length > MAX_BALANCE_SMS) d.balanceSms.splice(0, d.balanceSms.length - MAX_BALANCE_SMS);
  return fresh.length;
}

/**
 * Rows queued before balance announcements were recognised (rule 99): an SMS row whose text is only a
 * balance leaves the queue for the balance list. `api` is the SMS parser (lib/finance/sms.ts).
 * Returns how many moved.
 */
export function moveQueuedBalances(d: FinanceData, api: Pick<SmsApi, 'balanceReport'>, now: number): number {
  if (!api.balanceReport) return 0;
  const moved: Staged[] = [];
  for (const r of d.inbox) {
    if (r.source !== 'sms' || !r.raw) continue;
    const b = api.balanceReport(r.raw.trim());
    if (!b) continue;
    const k = /تومان/.test(r.raw) && !/ریال|ريال/.test(r.raw) ? 10 : 1;
    moved.push({ ...r, balanceOnly: true, amountRial: 0, direction: null, balanceRial: b.balance * k, card: b.cardLast4, accountNo: b.accountNo });
  }
  if (!moved.length) return 0;
  const ids = new Set(moved.map((r) => r.id));
  d.inbox = d.inbox.filter((r) => !ids.has(r.id));
  noteBalanceSms(d, moved.filter((r) => r.smsKey), now);
  return moved.length;
}

/** The account a balance SMS belongs to: only through a card/account the user linked (rule 45). */
export function balanceSmsAccount(d: FinanceData, b: Pick<BalanceSms, 'card' | 'accountNo'>): string | null {
  for (const key of sourceKeys(b)) {
    const src = (d.smsSources ?? []).find((x) => x.key === key);
    if (src?.accountId && d.accounts.some((a) => a.id === src.accountId)) return src.accountId;
  }
  return null;
}

/** queueSms + noteBalanceSms for one read of the phone or one paste. */
export function queueSmsResult(d: FinanceData, r: Pick<SmsResult, 'rows' | 'balances'>, now: number): { added: number; newSources: number; balances: number; dismissed: number } {
  const before = (d.smsSources ?? []).length;
  const dismissed = r.rows.filter((x) => wasDismissed(d, x)).length;
  const balances = noteBalanceSms(d, r.balances ?? [], now);
  const q = queueSms(d, r.rows, now);
  return { added: q.added, newSources: (d.smsSources ?? []).length - before, balances, dismissed };
}

/** Links a card/account to one of the user's accounts (or unlinks with null) and applies it to the queue. */
export function linkSource(d: FinanceData, key: string, accountId: string | null) {
  const src = d.smsSources.find((x) => x.key === key);
  if (!src) return;
  src.accountId = accountId;
  src.ignored = false;
  if (!accountId) return;
  for (const r of d.inbox) if (!r.accountId && sourceKeys(r).includes(key)) r.accountId = accountId;
  if (src.lastBalanceRial !== null && src.lastBalanceAt !== null) reportBalance(d, accountId, src.lastBalanceRial, src.lastBalanceAt, 'sms');
}

/** A new bank account for a card/account seen in SMS. Opening balance 0 until «یکی کردن با بانک». */
export function createAccountForSource(d: FinanceData, key: string, name: string, today: Iso): string | null {
  const src = d.smsSources.find((x) => x.key === key);
  if (!src) return null;
  const firstQueued = d.inbox.filter((r) => sourceKeys(r).includes(key) && r.date).map((r) => r.date!).sort()[0];
  const a: Account = { id: newId('a'), name: name.trim() || sourceLabel(src), kind: 'bank', openingRial: 0, openedOn: firstQueued && firstQueued < today ? firstQueued : today };
  d.accounts.push(a);
  linkSource(d, key, a.id);
  return a.id;
}

/** When the user books a row to an account, its unlinked cards learn that account. */
export function learnFromCommit(d: FinanceData, row: Staged, accountId: string) {
  for (const key of sourceKeys(row)) {
    const src = d.smsSources.find((x) => x.key === key);
    if (src && !src.accountId && !src.ignored) linkSource(d, key, accountId);
  }
}

export interface Reconcile {
  reportedRial: number;
  date: Iso;
  time: string | null;
  via: 'sms' | 'statement' | 'manual' | 'exchange';
  /** what the book says the balance was at that same moment */
  bookRial: number;
  /** bank − book; positive means the book is short */
  diffRial: number;
  /** rows still waiting in the queue for this account — the usual reason for a difference */
  pending: number;
}

/**
 * Bank-stated balance against the book at the same moment: opening + every transaction dated
 * up to then (same-day transactions without a time count as before it).
 */
export function reconcile(d: FinanceData, accountId: string): Reconcile | null {
  const a = d.accounts.find((x) => x.id === accountId);
  if (!a?.reported) return null;
  const R = a.reported;
  const upTo = (date: Iso, time?: string | null) => date < R.date || (date === R.date && (!time || !R.time || time <= R.time));
  let book = a.openingRial;
  for (const t of d.txns) {
    if (!upTo(t.date, t.time)) continue;
    if (t.kind === 'income' && t.accountId === accountId) book += t.amountRial;
    else if (t.kind === 'expense' && t.accountId === accountId) book -= t.amountRial;
    else if (t.kind === 'transfer') {
      if (t.accountId === accountId) book -= t.amountRial;
      if (t.toAccountId === accountId) book += t.amountRial;
    }
  }
  return {
    reportedRial: R.rial,
    date: R.date,
    time: R.time ?? null,
    via: R.via,
    bookRial: book,
    diffRial: R.rial - book,
    pending: d.inbox.filter((r) => r.accountId === accountId).length,
  };
}

/** «یکی کردن با بانک»: the opening balance absorbs the difference, so the book agrees with the bank. */
export function applyReconcile(d: FinanceData, accountId: string): number {
  const r = reconcile(d, accountId);
  const a = d.accounts.find((x) => x.id === accountId);
  if (!r || !a || r.diffRial === 0) return 0;
  a.openingRial += r.diffRial;
  return r.diffRial;
}

/** Cards/accounts seen in SMS that are not linked yet (and not dismissed). */
export const unlinkedSources = (d: FinanceData) => (d.smsSources ?? []).filter((s) => !s.accountId && !s.ignored);
