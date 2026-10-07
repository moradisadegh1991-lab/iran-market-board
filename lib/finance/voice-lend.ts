// قرض by voice (rule 84): «پنج میلیون به علی قرض دادم از کارت ملت», «دو میلیون از رضا قرض گرفتم»,
// «علی سه میلیون از قرضش رو پس داد», «قرض مریم رو پس دادم». The same rules as every voice dialog (rule 68): understood
// on the device, what is missing asked with buttons, read back with the amount in words, booked only on «بله».
// Personal and business lending are never mixed: with a business, a loan that names neither the shop nor a personal
// account is asked about — «از پول خودت یا از کسب‌وکار؟» — never guessed (rule 3).
import { amountIn, amountWords, clean, tokens, type Hit } from './voice';
import { accountHits } from './voice';
import { bookLend, LEND_LABEL, people, type LendKind } from './lending';
import { deleteTxn } from './actions';
import { isMoneyAccount, type Account, type FinanceData, type Iso } from './model';

export interface LendDraft {
  kind: LendKind | null;
  person: string | null;
  amountRial: number | null;
  accountId: string | null;
  /** with a business: whose money — null until said or asked */
  side: 'me' | 'biz' | null;
}
export type LendAsk = 'kind' | 'person' | 'amount' | 'side' | 'account' | 'confirm' | 'fix';
export interface LendState {
  draft: LendDraft;
  asking: LendAsk;
  options: { key: string; label: string }[];
  say: string;
  done: null | 'save' | 'cancel';
  misses: number;
}

const RX_CANCEL = /(^| )(لغو|کنسل|بیخیال|بی خیال|ولش کن|نمیخوام|نمی خوام|ثبت نکن|منصرف)( |$)/;
const RX_YES = /^(بله|بلی|آره|اره|آری|باشه|اوکی|ok|yes|حتما|درسته|درست|ثبت کن|ثبتش کن|بزن|همینه|خوبه|تایید|تأیید)( .*)?$/;
const RX_NO = /^(نه|نخیر|خیر|نچ|no|غلطه|اشتباهه|درست نیست)( |$)/;
const RX_LOAN = /(^| )(قرض|قرضی|دستی|بدهی|بدهیم|بدهیشو|بدهیش|طلب|طلبم|طلبمو|طلبشو|قرضش|قرضشو|قرضمو|قرضم)( |$)/;
const RX_SHOP = /(^| )(مغازه|کسب ?و ?کار|کسبوکار|فروشگاه|کافه|سالن|کارگاه|صندوق مغازه|حساب مغازه)( |$)/;
const RX_MINE = /(^| )(شخصی|خودم|جیب خودم|پول خودم)( |$)/;
const STOP = new Set(['به', 'از', 'را', 'رو', 'قرض', 'قرضی', 'قرضش', 'قرضشو', 'قرضمو', 'قرضم', 'قرضت', 'قرضتو', 'بدهیش', 'بدهیشو', 'طلبش', 'طلبشو', 'طلبم', 'طلبمو', 'من', 'بهم', 'بهش', 'اش', 'دادم', 'داد', 'گرفتم', 'پس', 'تومن', 'تومان', 'ریال', 'هزار', 'میلیون', 'میلیارد', 'کارت', 'حساب', 'نقد', 'نقدی', 'کیف', 'پول', 'با', 'هم', 'و', 'یه', 'یک', 'دستی', 'امروز', 'دیروز', 'برای', 'بدهی', 'طلب', 'آقا', 'خانم']);

/** what kind of loan the sentence says; null when it is not about a loan */
export function lendKindIn(text: string): LendKind | null {
  const c = ` ${clean(text)} `;
  const loanish = RX_LOAN.test(c) || / پس (داد|دادم|داده|دادن|گرفتم|آورد|اورد) /.test(c) || / (برگردوند|برگرداند|برگردوندم|برگرداندم) /.test(c);
  if (!loanish) return null;
  if (/ (پس دادم|برگردوندم|برگرداندم|قرضمو دادم|بدهیمو دادم|بدهیم رو دادم|تسویه کردم) /.test(c)) return 'repay';
  if (/ (پس داد|پس داده|پس دادن|پس آورد|پس اورد|برگردوند|برگرداند|طلبمو داد|طلبم رو داد|قرضشو داد|قرضش رو داد|بدهیشو داد|تسویه کرد) /.test(c)) return 'repaid';
  if (/ (قرض|قرضی|دستی) (دادم|دادیم|داده ام|دادم بهش) /.test(c) || / قرض به .* دادم /.test(c) || / دادم .* قرض /.test(c)) return 'lend';
  if (/ (قرض|قرضی|دستی) (گرفتم|گرفتیم|کردم|کردیم) /.test(c) || / از .* قرض /.test(c)) return 'borrow';
  return null;
}

/** «به علی», «از رضا»; for «علی پس داد» the first words before the amount and the verb */
export function personIn(d: FinanceData, text: string, kind: LendKind | null): string | null {
  const toks = clean(text).split(' ');
  const known = d.accounts.filter((a) => a.kind === 'person').map((a) => clean(a.name));
  for (const k of known) if (` ${toks.join(' ')} `.includes(` ${k} `)) return d.accounts.find((a) => a.kind === 'person' && clean(a.name) === k)!.name;
  const isWord = (w: string) => w && !STOP.has(w) && !/^\d/.test(w) && !(tokens(w).length && amountIn(tokens(w), false));
  const after = (prep: string) => {
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i] !== prep) continue;
      const name: string[] = [];
      for (let j = i + 1; j < toks.length && name.length < 3 && isWord(toks[j]); j++) name.push(toks[j]);
      if (name.length) return name.join(' ');
    }
    return null;
  };
  // «علی … پس داد»: the subject comes first
  if (kind === 'repaid') {
    const name: string[] = [];
    for (const w of toks) {
      if (!isWord(w) || name.length >= 3) break;
      name.push(w);
    }
    if (name.length) return name.join(' ');
  }
  // «قرض مریم رو پس دادم», «طلب علی»
  for (let i = 0; i < toks.length - 1; i++) {
    if (!/^(قرض|طلب|بدهی)$/.test(toks[i])) continue;
    const name: string[] = [];
    for (let j = i + 1; j < toks.length && name.length < 3 && isWord(toks[j]); j++) name.push(toks[j]);
    if (name.length) return name.join(' ');
  }
  const prefer = kind === 'borrow' ? ['از', 'به'] : ['به', 'از'];
  for (const p of prefer) {
    const n = after(p);
    if (n && !/^(حساب|کارت|صندوق|مغازه)/.test(n)) return n.replace(/(شو|ش|رو)$/, '') || n;
  }
  return null;
}

const ownAccounts = (d: FinanceData, side: 'me' | 'biz') => d.accounts.filter((a) => isMoneyAccount(a) && (side === 'biz' ? !!a.bizId : !a.bizId));
const state = (s: Omit<LendState, 'done' | 'misses'>, misses = 0): LendState => ({ ...s, done: null, misses });

/** what a sentence adds to the draft */
function absorb(d: FinanceData, n: LendDraft, text: string, asking: LendAsk): { draft: LendDraft; used: boolean } {
  const out = { ...n };
  let used = false;
  const c = ` ${clean(text)} `;
  const k = lendKindIn(text);
  if (k) ((out.kind = k), (used = true));
  const amt = amountIn(tokens(text), asking !== 'amount');
  if (amt && amt.rial >= 10_000) ((out.amountRial = amt.rial), (used = true));
  const who = personIn(d, text, out.kind);
  if (who) ((out.person = who), (used = true));
  else if (asking === 'person') {
    const bare = clean(text)
      .split(' ')
      .filter((w) => !STOP.has(w) && !/^\d/.test(w))
      .slice(0, 3)
      .join(' ');
    if (bare) ((out.person = bare), (used = true));
  }
  if (d.biz) {
    if (RX_SHOP.test(c) || (d.biz.name && c.includes(` ${clean(d.biz.name)} `))) {
      out.side = 'biz';
      used = true;
      // «صندوق مغازه» is the shop's cash, «کارت مغازه» its card
      if (/ صندوق /.test(c) && d.biz.cashAccountId) out.accountId = d.biz.cashAccountId;
      else if (/ کارت /.test(c) && d.biz.cardAccountId) out.accountId = d.biz.cardAccountId;
    } else if (RX_MINE.test(c)) ((out.side = 'me'), (used = true));
  }
  const hits: Hit[] = accountHits(d, text).filter((h) => {
    const a = d.accounts.find((x) => x.id === h.id);
    return a && isMoneyAccount(a);
  });
  if (hits.length && !(out.side === 'biz' && out.accountId)) {
    const a = d.accounts.find((x) => x.id === hits[0].id)!;
    out.accountId = a.id;
    out.side = a.bizId ? 'biz' : 'me';
    used = true;
  }
  // a repayment goes where the loan is: if the person has a loan on one side only, that side
  if (d.biz && !out.side && out.person && (out.kind === 'repaid' || out.kind === 'repay')) {
    const sides = new Set(d.accounts.filter((a) => a.kind === 'person' && clean(a.name) === clean(out.person!)).map((a) => (a.bizId ? 'biz' : 'me')));
    if (sides.size === 1) out.side = [...sides][0] as 'me' | 'biz';
  }
  return { draft: out, used };
}

const toWord = (k: LendKind) => (k === 'lend' || k === 'repay' ? 'به' : 'از');
function next(d: FinanceData, n: LendDraft): Omit<LendState, 'done' | 'misses'> {
  if (!n.kind)
    return { draft: n, asking: 'kind', options: (['lend', 'borrow', 'repaid', 'repay'] as LendKind[]).map((k) => ({ key: k, label: LEND_LABEL[k] })), say: 'قرض دادی، قرض گرفتی، یا پس دادن قرض؟' };
  if (!n.person) {
    const side = n.side ?? 'me';
    const known = people(d, side === 'biz' && d.biz ? d.biz.id : null).slice(0, 6);
    return { draft: n, asking: 'person', options: known.map((a) => ({ key: a.id, label: a.name })), say: n.kind === 'lend' || n.kind === 'repay' ? 'به کی؟' : 'از کی؟' };
  }
  if (!n.amountRial) return { draft: n, asking: 'amount', options: [], say: 'چقدر؟' };
  // personal or the business's money — asked, never guessed, when there is a business
  if (!n.side) {
    if (!d.biz) n = { ...n, side: 'me' };
    else
      return {
        draft: n,
        asking: 'side',
        options: [
          { key: 'me', label: 'از پول خودم (شخصی)' },
          { key: 'biz', label: `از کسب‌وکار (${d.biz.name})` },
        ],
        say: 'از پول خودت یا از کسب‌وکار؟',
      };
  }
  if (!n.accountId) {
    const own = ownAccounts(d, n.side!);
    if (own.length === 1) n = { ...n, accountId: own[0].id };
    else
      return {
        draft: n,
        asking: 'account',
        options: own.slice(0, 6).map((a: Account) => ({ key: a.id, label: a.name })),
        say: n.kind === 'lend' || n.kind === 'repay' ? 'از کدوم حساب؟' : 'به کدوم حساب اومد؟',
      };
  }
  const acc = d.accounts.find((a) => a.id === n.accountId)!;
  const amt = n.amountRial!;
  const kind = n.kind!;
  const what =
    kind === 'lend'
      ? `${amountWords(amt)} به ${n.person} قرض دادی`
      : kind === 'borrow'
        ? `${amountWords(amt)} از ${n.person} قرض گرفتی`
        : kind === 'repaid'
          ? `${n.person} ${amountWords(amt)} از قرضش رو پس داد`
          : `${amountWords(amt)} از قرضت رو به ${n.person} پس دادی`;
  return {
    draft: n,
    asking: 'confirm',
    options: [
      { key: 'yes', label: 'بله، ثبت کن' },
      { key: 'no', label: 'نه، عوضش کن' },
    ],
    say: `${what}، ${toWord(kind) === 'به' ? 'از' : 'به'} ${acc.name}${acc.bizId ? ' (حساب کسب‌وکار)' : ''}. ثبت کنم؟`,
  };
}

/** A sentence about a loan starts this dialog; anything else is null (then it is a transaction or a question). */
export function lendStart(d: FinanceData, text: string): LendState | null {
  const c = clean(text);
  if (/[?؟]/.test(text) || /(^| )(چقدر|چند|کی|کیا|کیه|کدوم)( |$)/.test(c)) return null;
  const k = lendKindIn(text);
  if (!k) return null;
  const empty: LendDraft = { kind: null, person: null, amountRial: null, accountId: null, side: null };
  return state(next(d, absorb(d, empty, text, 'kind').draft));
}

const FIX: { key: LendAsk | 'cancel'; label: string }[] = [
  { key: 'kind', label: 'نوع قرض' },
  { key: 'person', label: 'طرف قرض' },
  { key: 'amount', label: 'مبلغ' },
  { key: 'account', label: 'حساب' },
  { key: 'cancel', label: 'لغو' },
];

export function lendEdit(d: FinanceData, st: LendState, what: string): LendState {
  if (what === 'cancel') return { ...st, done: 'cancel', options: [], say: 'باشه، چیزی ثبت نشد.' };
  const n = { ...st.draft };
  if (what === 'kind') n.kind = null;
  if (what === 'person') n.person = null;
  if (what === 'amount') n.amountRial = null;
  if (what === 'account') ((n.accountId = null), (n.side = d.biz ? null : n.side));
  return state(next(d, n));
}

export function lendChoose(d: FinanceData, st: LendState, key: string): LendState {
  if (st.done) return st;
  const n = { ...st.draft };
  if (st.asking === 'confirm') return key === 'yes' ? { ...st, done: 'save', options: [], say: 'ثبت شد.' } : state({ draft: n, asking: 'fix', options: FIX, say: 'چی رو عوض کنم؟' });
  if (st.asking === 'fix') return lendEdit(d, st, key);
  if (st.asking === 'kind') n.kind = key as LendKind;
  else if (st.asking === 'person') n.person = d.accounts.find((a) => a.id === key)?.name ?? key;
  else if (st.asking === 'side') ((n.side = key as 'me' | 'biz'), (n.accountId = null));
  else if (st.asking === 'account') n.accountId = key;
  return state(next(d, n));
}

export function lendAnswer(d: FinanceData, st: LendState, heard: string | string[]): LendState {
  const alts = (Array.isArray(heard) ? heard : [heard]).map((x) => x.trim()).filter(Boolean);
  if (!alts.length || st.done) return st;
  if (alts.some((a) => RX_CANCEL.test(clean(a)))) return { ...st, done: 'cancel', options: [], say: 'باشه، چیزی ثبت نشد.' };
  for (const a of alts) {
    const o = st.options.find((x) => clean(x.label) === clean(a) || clean(x.label).startsWith(clean(a)));
    if (o && clean(a).length >= 2) return lendChoose(d, st, o.key);
  }
  if (st.asking === 'confirm') {
    if (alts.some((a) => RX_YES.test(clean(a)) && !RX_NO.test(clean(a)))) return { ...st, done: 'save', options: [], say: 'ثبت شد.' };
    for (const a of alts) {
      const body = clean(a).replace(RX_NO, ' ').trim();
      const r = body ? absorb(d, st.draft, body, 'fix') : null;
      if (r?.used) return state(next(d, r.draft));
    }
    if (RX_NO.test(clean(alts[0]))) return state({ draft: st.draft, asking: 'fix', options: FIX, say: 'چی رو عوض کنم؟' });
  } else {
    for (const a of alts) {
      const r = absorb(d, st.draft, a, st.asking);
      if (r.used) return state(next(d, r.draft));
    }
  }
  return { ...st, say: `متوجه نشدم. ${st.say.replace(/^متوجه نشدم\. /, '')}`, misses: st.misses + 1 };
}

export type LendUndo = { txnId: string };
export function commitLend(d: FinanceData, st: LendState, today: Iso): LendUndo | string {
  const n = st.draft;
  if (st.done !== 'save' || !n.kind || !n.person || !n.amountRial || !n.accountId) return 'چیزی برای ثبت نیست.';
  const t = bookLend(d, { kind: n.kind, person: n.person, accountId: n.accountId, amountRial: n.amountRial, date: today });
  return typeof t === 'string' ? t : { txnId: t.id };
}
export function undoLend(d: FinanceData, u: LendUndo): void {
  deleteTxn(d, u.txnId);
}

export function lendRows(d: FinanceData, st: LendState): { key: string; label: string; value: string | null }[] {
  const n = st.draft;
  const acc = n.accountId ? d.accounts.find((a) => a.id === n.accountId) : null;
  return [
    { key: 'kind', label: 'قرض', value: n.kind ? LEND_LABEL[n.kind] : null },
    { key: 'person', label: 'طرف', value: n.person },
    { key: 'amount', label: 'مبلغ', value: n.amountRial ? `${Math.round(n.amountRial / 10).toLocaleString('fa-IR')} تومان` : null },
    { key: 'account', label: 'حساب', value: acc ? `${acc.name}${acc.bizId ? ' (کسب‌وکار)' : ''}` : n.side === 'biz' ? 'کسب‌وکار' : n.side === 'me' ? 'شخصی' : null },
  ];
}
