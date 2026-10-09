// قرض by voice (rule 84): «پنج میلیون به علی قرض دادم از کارت ملت», «دو میلیون از رضا قرض گرفتم»,
// «علی سه میلیون از قرضش رو پس داد», «قرض مریم رو پس دادم». The same rules as every voice dialog (rule 68): understood
// on the device, what is missing asked with buttons, read back with the amount in words, booked only on «بله».
// Personal and business lending are never mixed: with a business, a loan that names neither the shop nor a personal
// account is asked about — «از پول خودت یا از کسب‌وکار؟» — never guessed (rule 3).
// The bank's SMS of the same money is found and booked with the loan (rule 88): it fills what was not said (the amount,
// the account), a «۵۰ تومن» is read as the SMS's ۵۰ هزار or ۵۰ میلیون, an SMS already booked as spending becomes the
// loan, and an SMS from the other side (the shop's card for a personal loan) is never taken.
import { amountIn, amountWords, clean, tokens, type Hit } from './voice';
import { accountHits } from './voice';
import { bookLend, LEND_LABEL, lendSmsCandidates, people, type LendKind, type LendSms } from './lending';
import { bookLendWithSms, undoLendWithSms, type LendUndo } from './lend-sms';
import { isMoneyAccount, type Account, type FinanceData, type Iso } from './model';

export interface LendDraft {
  kind: LendKind | null;
  person: string | null;
  amountRial: number | null;
  accountId: string | null;
  /** with a business: whose money — null until said or asked */
  side: 'me' | 'biz' | null;
  /** the bank's SMS of this money (rule 88) */
  sms?: LendSms | null;
  /** «۵۰ تومن»: a number said without هزار/میلیون, in toman — the SMS or a question decides which */
  small?: number | null;
}
export type LendAsk = 'kind' | 'person' | 'amount' | 'side' | 'account' | 'confirm' | 'fix';
export interface LendState {
  draft: LendDraft;
  asking: LendAsk;
  options: { key: string; label: string }[];
  say: string;
  done: null | 'save' | 'cancel';
  misses: number;
  /** today, for finding the SMS; without it no SMS is looked for */
  today?: Iso | null;
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
const state = (s: Omit<LendState, 'done' | 'misses' | 'today'>, today: Iso | null | undefined, misses = 0): LendState => ({ ...s, done: null, misses, today: today ?? null });
const fa = (n: number) => n.toLocaleString('fa-IR');
const tomanOf = (rial: number) => `${fa(Math.round(rial / 10))} تومان`;

/** the SMS as it is said back: «پیامک ملت، ۱۷ مهر ساعت ۱۰:۱۲» */
function smsLabel(d: FinanceData, m: LendSms, today: Iso): string {
  const acc = m.accountId ? d.accounts.find((a) => a.id === m.accountId) : null;
  const who = m.bank ? m.bank.replace(/^بانک /, '') : acc?.name ?? 'بانک';
  const when = m.date === today ? 'امروز' : 'روز ' + fa(Number(m.date.slice(8)));
  return `پیامک ${who}، ${when}${m.time ? ` ساعت ${m.time.replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[+c])}` : ''}`;
}

/** takes one SMS for the draft: its amount and account fill what was not said; the other side's SMS is not taken */
function takeSms(d: FinanceData, n: LendDraft, m: LendSms): LendDraft {
  const acc = m.accountId ? d.accounts.find((a) => a.id === m.accountId) : null;
  // the shop card's SMS is the shop's money: only when the business side was said (rule 84 — never guessed)
  if (d.biz && acc?.bizId && n.side !== 'biz') return n;
  const out: LendDraft = { ...n, sms: m, amountRial: m.amountRial, small: null };
  if (!out.accountId && acc) out.accountId = acc.id;
  if (!out.side && acc) out.side = acc.bizId ? 'biz' : 'me';
  return out;
}

/** finds the bank's SMS of this loan, keeping one already linked while it still fits */
function linkSms(d: FinanceData, n: LendDraft, today: Iso | null | undefined): LendDraft {
  if (!today || !n.kind) return n;
  if (n.sms && n.sms.amountRial === n.amountRial && (!n.accountId || !n.sms.accountId || n.sms.accountId === n.accountId)) return n;
  const base = { ...n, sms: null };
  const p = { kind: n.kind, accountId: n.accountId, side: n.side, today };
  if (base.amountRial) {
    const c = lendSmsCandidates(d, { ...p, amountRial: base.amountRial });
    return c.length ? takeSms(d, base, c[0]) : base;
  }
  if (base.small) {
    // «۵۰ تومن» with an SMS of ۵۰ هزار (or ۵۰ میلیون) تومان is that SMS
    const c = lendSmsCandidates(d, p).filter((x) => x.amountRial === base.small! * 10_000 || x.amountRial === base.small! * 10_000_000);
    if (c.length === 1 || (c.length > 1 && c.every((x) => x.amountRial === c[0].amountRial))) return takeSms(d, base, c[0]);
  }
  return base;
}

/** what a sentence adds to the draft */
function absorb(d: FinanceData, n: LendDraft, text: string, asking: LendAsk): { draft: LendDraft; used: boolean } {
  const out = { ...n };
  let used = false;
  const c = ` ${clean(text)} `;
  const k = lendKindIn(text);
  if (k) ((out.kind = k), (used = true));
  const amt = amountIn(tokens(text), asking !== 'amount');
  if (amt && amt.rial >= 10_000) ((out.amountRial = amt.rial), (out.small = null), (used = true));
  else if (amt && amt.rial > 0 && !out.amountRial) ((out.small = Math.round(amt.rial / 10)), (used = true));
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
function next(d: FinanceData, n: LendDraft, today?: Iso | null): Omit<LendState, 'done' | 'misses' | 'today'> {
  n = linkSms(d, n, today);
  if (!n.kind)
    return { draft: n, asking: 'kind', options: (['lend', 'borrow', 'repaid', 'repay'] as LendKind[]).map((k) => ({ key: k, label: LEND_LABEL[k] })), say: 'قرض دادی، قرض گرفتی، یا پس دادن قرض؟' };
  if (!n.person) {
    const side = n.side ?? 'me';
    const known = people(d, side === 'biz' && d.biz ? d.biz.id : null).slice(0, 6);
    return { draft: n, asking: 'person', options: known.map((a) => ({ key: a.id, label: a.name })), say: n.kind === 'lend' || n.kind === 'repay' ? 'به کی؟' : 'از کی؟' };
  }
  // personal or the business's money — asked, never guessed, when there is a business; before the amount, since the
  // answer decides which bank SMS is this money (a personal loan never takes the shop card's SMS)
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
  if (!n.amountRial) {
    // «۵۰ تومن»: thousand or million — asked, not guessed (rule 68)
    if (n.small)
      return {
        draft: n,
        asking: 'amount',
        options: [
          { key: `k:${n.small * 10_000}`, label: `${fa(n.small)} هزار تومان` },
          { key: `k:${n.small * 10_000_000}`, label: `${fa(n.small)} میلیون تومان` },
        ],
        say: `${fa(n.small)} هزار یا ${fa(n.small)} میلیون تومن؟`,
      };
    // the bank's recent SMS of this direction, to pick from
    const c = today ? lendSmsCandidates(d, { kind: n.kind!, accountId: n.accountId, side: n.side, today, days: 1 }).filter((m) => m.accountId) : [];
    return {
      draft: n,
      asking: 'amount',
      options: c.slice(0, 3).map((m) => ({ key: `sms:${m.kind}:${m.id}`, label: `${tomanOf(m.amountRial)} (${smsLabel(d, m, today!)})` })),
      say: c.length ? 'چقدر؟ اگه همین پیامک بانکه، انتخابش کن.' : 'چقدر؟',
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
    say:
      `${what}، ${toWord(kind) === 'به' ? 'از' : 'به'} ${acc.name}${acc.bizId ? ' (حساب کسب‌وکار)' : d.biz ? ' (پول شخصی)' : ''}` +
      (n.sms && today ? `؛ همون ${smsLabel(d, n.sms, today)}` : '') +
      '. ثبت کنم؟',
  };
}

/** A sentence about a loan starts this dialog; anything else is null (then it is a transaction or a question). */
export function lendStart(d: FinanceData, text: string, today?: Iso | null): LendState | null {
  const c = clean(text);
  if (/[?؟]/.test(text) || /(^| )(چقدر|چند|کی|کیا|کیه|کدوم)( |$)/.test(c)) return null;
  const k = lendKindIn(text);
  if (!k) return null;
  const empty: LendDraft = { kind: null, person: null, amountRial: null, accountId: null, side: null, sms: null, small: null };
  return state(next(d, absorb(d, empty, text, 'kind').draft, today), today);
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
  if (what === 'amount') ((n.amountRial = null), (n.small = null), (n.sms = null));
  if (what === 'account') ((n.accountId = null), (n.side = d.biz ? null : n.side), (n.sms = null));
  return state(next(d, n, st.today), st.today);
}

export function lendChoose(d: FinanceData, st: LendState, key: string): LendState {
  if (st.done) return st;
  const n = { ...st.draft };
  if (st.asking === 'confirm') return key === 'yes' ? { ...st, done: 'save', options: [], say: 'ثبت شد.' } : state({ draft: n, asking: 'fix', options: FIX, say: 'چی رو عوض کنم؟' }, st.today);
  if (st.asking === 'fix') return lendEdit(d, st, key);
  if (st.asking === 'kind') n.kind = key as LendKind;
  else if (st.asking === 'person') n.person = d.accounts.find((a) => a.id === key)?.name ?? key;
  else if (st.asking === 'side') ((n.side = key as 'me' | 'biz'), (n.accountId = null), (n.sms = null));
  else if (st.asking === 'account') ((n.accountId = key), (n.sms = null));
  else if (st.asking === 'amount' && key.startsWith('k:')) ((n.amountRial = Number(key.slice(2))), (n.small = null));
  else if (st.asking === 'amount' && key.startsWith('sms:') && st.today && n.kind) {
    const [, kind, id] = key.split(':');
    const m = lendSmsCandidates(d, { kind: n.kind, today: st.today, days: 1 }).find((x) => x.kind === kind && x.id === id);
    if (m) return state(next(d, takeSms(d, n, m), st.today), st.today);
  }
  return state(next(d, n, st.today), st.today);
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
      if (r?.used) return state(next(d, r.draft, st.today), st.today);
    }
    if (RX_NO.test(clean(alts[0]))) return state({ draft: st.draft, asking: 'fix', options: FIX, say: 'چی رو عوض کنم؟' }, st.today);
  } else {
    for (const a of alts) {
      const r = absorb(d, st.draft, a, st.asking);
      if (r.used) return state(next(d, r.draft, st.today), st.today);
    }
  }
  return { ...st, say: `متوجه نشدم. ${st.say.replace(/^متوجه نشدم\. /, '')}`, misses: st.misses + 1 };
}

export type { LendUndo } from './lend-sms';
export function commitLend(d: FinanceData, st: LendState, today: Iso): LendUndo | string {
  const n = st.draft;
  if (st.done !== 'save' || !n.kind || !n.person || !n.amountRial || !n.accountId) return 'چیزی برای ثبت نیست.';
  return bookLendWithSms(d, { kind: n.kind, person: n.person, accountId: n.accountId, amountRial: n.amountRial, date: today }, n.sms ?? null);
}
export function undoLend(d: FinanceData, u: LendUndo): void {
  undoLendWithSms(d, u);
}

export function lendRows(d: FinanceData, st: LendState): { key: string; label: string; value: string | null }[] {
  const n = st.draft;
  const acc = n.accountId ? d.accounts.find((a) => a.id === n.accountId) : null;
  return [
    { key: 'kind', label: 'قرض', value: n.kind ? LEND_LABEL[n.kind] : null },
    { key: 'person', label: 'طرف', value: n.person },
    { key: 'amount', label: 'مبلغ', value: n.amountRial ? `${Math.round(n.amountRial / 10).toLocaleString('fa-IR')} تومان` : null },
    { key: 'account', label: 'حساب', value: acc ? `${acc.name}${acc.bizId ? ' (کسب‌وکار)' : ''}` : n.side === 'biz' ? 'کسب‌وکار' : n.side === 'me' ? 'شخصی' : null },
    ...(n.sms && st.today ? [{ key: 'open', label: 'پیامک بانک', value: smsLabel(d, n.sms, st.today) }] : []),
  ];
}
