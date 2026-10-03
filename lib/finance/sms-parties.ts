// «مبدا و مقصد» of a bank SMS — the pure half.
//
// The parser (sms-parser.js, mirrored line by line in BankSms.java — rule 50) reads amount,
// direction, the user's card/account and the balance. This file reads what it leaves out: who the
// money went to or came from, and which bank sent the message. Everything here is a SUGGESTION shown
// next to the queue row with the evidence it came from; nothing is applied until the user taps it
// (rule 45: the app never decides by itself which account a card belongs to; rule 3: no guessed
// direction — the side of the user's own account follows the direction the bank stated).
//
// Formats are written from the common wording of Iranian bank SMS («انتقال به کارت …»، «خرید از
// پذیرنده …»، «واریز از …»، «بابت …») — not yet checked against the user's own bank's messages (rule 33).
import type { Account, FinanceData, Staged } from './model';
import { memoryKey, norm } from './importers';

export type PartyKind = 'mine' | 'own-account' | 'card' | 'account' | 'sheba' | 'person' | 'merchant' | 'cash' | 'bill' | 'loan' | 'salary' | 'interest' | 'subsidy' | 'refund' | 'unknown';

export interface Party {
  /** what the page shows: «کارت ۵۶۷۸ (علی رضایی)»، «فروشگاه رفاه»، «حساب ملت شما» */
  label: string;
  kind: PartyKind;
  /** card last-4, account number or IBAN, when the SMS gave one */
  ref?: string | null;
  name?: string | null;
  /** one of the user's own accounts, when the ref is a card/account the app already knows */
  accountId?: string | null;
  /** the evidence, in Persian: «از متن: انتقال به کارت …» */
  why: string;
}

export interface BankGuess {
  /** «بانک ملت» */
  name: string;
  /** the short form account names usually carry: «ملت» */
  short: string;
  via: 'sender' | 'text';
}

export interface PartySuggestion {
  bank: BankGuess | null;
  from: Party | null;
  to: Party | null;
  /** «بابت …» / «شرح …» when the SMS states a purpose */
  purpose: string | null;
  /** the row has no account yet and exactly one of the user's accounts carries this bank's name */
  account: { accountId: string; name: string; why: string } | null;
  /** the other side is one of the user's own accounts: book it as a transfer between them */
  transfer: { choice: 'transfer-out' | 'transfer-in'; otherAccountId: string; name: string; why: string } | null;
  /** key for category memory: the counterparty, which says more than «کارت ۴۴۱۷» */
  memoryKey: string | null;
}

// ── banks ──

/** [display, short, patterns matched against the sender (latin/short code text) and the body] */
const BANKS: [string, string, RegExp][] = [
  ['بانک ملت', 'ملت', /mellat|بانک\s*ملت|^ملت\b/i],
  ['بانک ملی', 'ملی', /\bbmi\b|melli|بانک\s*ملی/i],
  ['بانک صادرات', 'صادرات', /saderat|\bbsi\b|بانک\s*صادرات/i],
  ['بانک تجارت', 'تجارت', /tejarat|بانک\s*تجارت/i],
  ['بانک سپه', 'سپه', /sepah|بانک\s*سپه/i],
  ['بانک کشاورزی', 'کشاورزی', /keshavarzi|agri|بانک\s*کشاورزی/i],
  ['بانک مسکن', 'مسکن', /maskan|بانک\s*مسکن/i],
  ['بانک رفاه', 'رفاه', /refah|بانک\s*رفاه/i],
  ['بانک پاسارگاد', 'پاسارگاد', /pasargad|\bbpi\b|بانک\s*پاسارگاد/i],
  ['بانک سامان', 'سامان', /saman|بانک\s*سامان/i],
  ['بلوبانک', 'بلو', /\bblu\b|blubank|بلو\s*بانک|بلوبانک/i],
  ['بانک پارسیان', 'پارسیان', /parsian|بانک\s*پارسیان/i],
  ['بانک اقتصاد نوین', 'اقتصاد نوین', /\ben\s*bank\b|eghtesad|بانک\s*اقتصاد\s*نوین/i],
  ['بانک آینده', 'آینده', /ayandeh|بانک\s*آینده/i],
  ['بانک شهر', 'شهر', /shahr\s*bank|citybank|بانک\s*شهر/i],
  ['بانک دی', 'دی', /\bdey\b|بانک\s*دی\b/i],
  ['بانک سینا', 'سینا', /\bsina\b|بانک\s*سینا/i],
  ['بانک کارآفرین', 'کارآفرین', /karafarin|بانک\s*کارآفرین/i],
  ['بانک سرمایه', 'سرمایه', /sarmayeh|بانک\s*سرمایه/i],
  ['بانک رسالت', 'رسالت', /resalat|بانک\s*(قرض\s*الحسنه\s*)?رسالت/i],
  ['بانک مهر ایران', 'مهر', /mehr\s*iran|qmb|بانک\s*(قرض\s*الحسنه\s*)?مهر/i],
  ['پست‌بانک', 'پست', /post\s*bank|postbank|پست\s*بانک/i],
  ['بانک توسعه تعاون', 'توسعه تعاون', /ttbank|tosee|توسعه\s*تعاون/i],
  ['بانک خاورمیانه', 'خاورمیانه', /middle\s*east|khavarmianeh|خاورمیانه/i],
  ['بانک گردشگری', 'گردشگری', /tourism|gardeshgari|بانک\s*گردشگری/i],
  ['بانک ایران‌زمین', 'ایران زمین', /iran\s*zamin|ایران\s*زمین/i],
  ['بانک توسعه صادرات', 'توسعه صادرات', /edbi|توسعه\s*صادرات/i],
];

/** The bank: from the sender name first (the phone inbox gives it), else from «بانک …» in the text. */
export function bankOf(sender: string | null | undefined, body: string): BankGuess | null {
  const s = norm(sender ?? '').trim();
  // a bare number says nothing about the bank — numeric short codes are not mapped (no guessing)
  if (s && /[A-Za-z؀-ۿ]/.test(s)) for (const [name, short, rx] of BANKS) if (rx.test(s)) return { name, short, via: 'sender' };
  const t = norm(body);
  for (const [name, short, rx] of BANKS) {
    // «توسعه صادرات» also contains «صادرات»: the longer names come later in BANKS, so check them all
    if (rx.test(t) && !BANKS.some(([n2, , r2]) => n2 !== name && n2.length > name.length && n2.includes(short) && r2.test(t))) return { name, short, via: 'text' };
  }
  return null;
}

// ── references in the text ──

const CARD = String.raw`(?:\d{4}[-\s]?)?(?:[\d*xX×]{2,4}[-\s]?){2}[*xX×]*(\d{4})|\*+\s?(\d{4})`;
const ACC = String.raw`(\d{6,}|\d{2,4}(?:[.-]\d{2,}){2,})`;
const SHEBA = String.raw`(IR\s?\d{2}(?:\s?\d){22})`;
/** a name: Persian words (and spaces), stops at digits, a newline or punctuation */
const NAME = String.raw`([؀-ۿA-Za-z‌][؀-ۿA-Za-z‌ \t.]{1,38}[؀-ۿA-Za-z‌])`;

const fa = (s: string) => s.replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]);
const clean = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\s*(?:مانده|موجودی|مبلغ|تاریخ|ساعت|کارمزد|به نام|بابت|شرح|حساب|کارت|شماره|پیگیری|مرجع|شبا)(?:\s|:|$)[^]*$/, '').trim();

interface RefHit {
  kind: 'card' | 'account' | 'sheba';
  ref: string;
  name: string | null;
  at: number;
}

/** A card / account / IBAN right after `lead` («به»، «از»، «مقصد»…), with the name that follows it. */
function refAfter(t: string, lead: string): RefHit | null {
  const rx = new RegExp(String.raw`(?:${lead})\s*:?\s*(?:کارت|کارت\s*شماره|شماره\s*کارت)\s*:?\s*(?:${CARD})|(?:${lead})\s*:?\s*(?:حساب|سپرده|شماره\s*حساب)\s*:?\s*${ACC}|(?:${lead})\s*:?\s*(?:شبا|شماره\s*شبا)?\s*:?\s*${SHEBA}`, 'i');
  const m = rx.exec(t);
  if (!m) return null;
  const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
  const nm = new RegExp(String.raw`^\s*[(\-–:]?\s*(?:به\s*نام|بنام|متعلق\s*به)?\s*:?\s*${NAME}`).exec(tail);
  const name = nm && !/^(مانده|موجودی|مبلغ|تاریخ|ساعت|کارمزد|بابت|شرح|ریال|تومان|با|در|به|از)\b/.test(nm[1].trim()) ? clean(nm[1]) : null;
  if (m[1] || m[2]) return { kind: 'card', ref: (m[1] || m[2])!, name, at: m.index };
  if (m[3]) return { kind: 'account', ref: m[3].replace(/[.-]/g, ''), name, at: m.index };
  return { kind: 'sheba', ref: m[4].replace(/\s/g, '').toUpperCase(), name, at: m.index };
}

function nameAfter(t: string, lead: string): string | null {
  const m = new RegExp(String.raw`(?:${lead})\s*:?\s*${NAME}`).exec(t);
  if (!m) return null;
  const n = clean(m[1]);
  return n.length >= 2 && !/^(کارت|حساب|شبا|شما|حساب شما|مبلغ|ریال|تومان)$/.test(n) ? n : null;
}

const refLabel = (h: { kind: string; ref: string; name: string | null }) =>
  `${h.kind === 'card' ? `کارت ${fa(h.ref)}` : h.kind === 'account' ? `حساب ${fa(h.ref)}` : `شبا …${fa(h.ref.slice(-6))}`}${h.name ? ` (${h.name})` : ''}`;

/** The user's own account that a card/account ref belongs to — only through links the user made. */
function ownAccountOf(d: FinanceData, kind: string, ref: string): Account | null {
  const key = kind === 'card' ? `card:${ref}` : kind === 'account' ? `acc:${ref}` : null;
  if (!key) return null;
  const src = (d.smsSources ?? []).find((x) => x.key === key && x.accountId);
  return src ? (d.accounts.find((a) => a.id === src.accountId && !a.archived) ?? null) : null;
}

/** Words that name the other side without a card or a name. */
const KIND_HINTS: [RegExp, PartyKind, string, 'out' | 'in' | null][] = [
  [/خودپرداز|\batm\b|دستگاه\s*عابر|برداشت\s*نقدی/i, 'cash', 'نقد (خودپرداز)', 'out'],
  [/قبض|آبفا|برق|گاز\b|مخابرات/, 'bill', 'قبض', 'out'],
  [/قسط|اقساط|تسهیلات/, 'loan', 'قسط وام', 'out'],
  [/شارژ\s*(?:سیم|تلفن|موبایل|همراه)|خرید\s*شارژ/, 'bill', 'شارژ تلفن همراه', 'out'],
  [/حقوق|مزایا|کارانه/, 'salary', 'حقوق (کارفرما)', 'in'],
  [/سود\s*(?:سپرده|حساب|علی\s*الحساب)|سود\b/, 'interest', 'سود سپرده (بانک)', 'in'],
  [/یارانه/, 'subsidy', 'یارانه', 'in'],
  [/عودت|برگشت|استرداد|بازگشت\s*وجه/, 'refund', 'برگشت وجه', 'in'],
];

/**
 * Who paid whom, read from the SMS text and its sender. `s.direction` (what the bank stated) decides
 * which side is the user's own account; without it both sides stay as read, unassigned.
 */
export function suggestParties(d: FinanceData, s: Staged): PartySuggestion {
  // line by line: newlines separate the fields, and a name must not run into the next line
  const t = s.raw.split(/\r?\n/).map(norm).join('\n');
  const out: PartySuggestion = { bank: bankOf(s.bank, s.raw), from: null, to: null, purpose: null, account: null, transfer: null, memoryKey: null };

  // ── the user's own side ──
  const myAccount = s.accountId ? d.accounts.find((a) => a.id === s.accountId) : null;
  // «واریز از کارت 6219-86**-****-9876»: the shared parser reads «6219» — the first digits of the
  // OTHER side's card — as the user's card. A real last-4 is not followed by more card digits.
  const myCard = s.card && !new RegExp(String.raw`کارت\s*:?\s*\*?${s.card}[\d*xX×-]`).test(t) ? s.card : null;
  const mineLabel = myAccount
    ? `${myAccount.name} (حساب شما)`
    : [myCard ? `کارت ${fa(myCard)}` : s.accountNo ? `حساب ${fa(s.accountNo)}` : null, out.bank?.name].filter(Boolean).join(' · ') || 'حساب شما';
  const mine: Party = { label: mineLabel, kind: 'mine', ref: myCard ?? s.accountNo ?? null, accountId: myAccount?.id ?? null, why: myAccount ? 'کارت/حسابی که به این حساب وصل کرده‌اید' : 'کارت یا حسابی که پیامک نام برده' };

  // ── the other side ──
  let other: Party | null = null;
  const own = (myCard ?? s.accountNo ?? '').replace(/\D/g, '');
  const notMine = (h: RefHit | null) => (h && h.ref !== own && !(own && h.ref.endsWith(own)) ? h : null);
  if (s.direction === 'out') {
    const h = notMine(refAfter(t, 'به|مقصد|گیرنده|انتقال\\s*به'));
    const merchant = nameAfter(t, 'پذیرنده|نام\\s*پذیرنده|فروشگاه|خرید\\s*از|خرید\\s*در|ترمینال|درگاه|مقصد');
    const person = nameAfter(t, 'به\\s*نام|بنام|گیرنده|در\\s*وجه');
    if (h) other = { label: refLabel({ ...h, name: h.name ?? person }), kind: h.kind, ref: h.ref, name: h.name ?? person, why: 'از متن: مقصد انتقال' };
    else if (merchant) other = { label: merchant, kind: 'merchant', name: merchant, why: 'از متن: نام پذیرنده/فروشگاه' };
    else if (person) other = { label: person, kind: 'person', name: person, why: 'از متن: نام گیرنده' };
  } else if (s.direction === 'in') {
    const h = notMine(refAfter(t, 'از|مبدا|فرستنده|واریز\\s*کننده|واریزکننده|از\\s*طرف'));
    const person = nameAfter(t, 'از\\s*طرف|واریز\\s*کننده|واریزکننده|فرستنده|به\\s*نام|بنام|مبدا|واریز\\s*از');
    if (h) other = { label: refLabel({ ...h, name: h.name ?? person }), kind: h.kind, ref: h.ref, name: h.name ?? person, why: 'از متن: مبدا واریز' };
    else if (person) other = { label: person, kind: 'person', name: person, why: 'از متن: نام واریزکننده' };
  }
  if (!other || other.kind === 'card' || other.kind === 'account' || other.kind === 'sheba') {
    for (const [rx, kind, label, dir] of KIND_HINTS)
      if (rx.test(t) && (!dir || !s.direction || dir === s.direction)) {
        if (!other) other = { label, kind, why: `از متن: «${rx.exec(t)![0]}»` };
        break;
      }
  }
  // the other side is a card or account the user already linked to one of their accounts
  if (other?.ref && (other.kind === 'card' || other.kind === 'account')) {
    const acc = ownAccountOf(d, other.kind, other.ref);
    if (acc && acc.id !== s.accountId) {
      other = { ...other, kind: 'own-account', accountId: acc.id, label: `${acc.name} (حساب دیگر شما) — ${other.label}`, why: `${other.why}؛ این ${other.kind === 'card' ? 'کارت' : 'حساب'} را قبلاً به «${acc.name}» وصل کرده‌اید` };
      if (s.direction) out.transfer = { choice: s.direction === 'out' ? 'transfer-out' : 'transfer-in', otherAccountId: acc.id, name: acc.name, why: other.why };
    }
  }
  // cash from an ATM is money moved into the user's own wallet, when they keep one
  if (other?.kind === 'cash' && s.direction === 'out' && !out.transfer) {
    const cash = d.accounts.filter((a) => a.kind === 'cash' && !a.archived && a.id !== s.accountId);
    if (cash.length === 1) out.transfer = { choice: 'transfer-out', otherAccountId: cash[0].id, name: cash[0].name, why: 'برداشت نقدی از خودپرداز به کیف پول نقد شما' };
  }

  if (s.direction === 'out') {
    out.from = mine;
    out.to = other;
  } else if (s.direction === 'in') {
    out.from = other;
    out.to = mine;
  }

  const purpose = /(?:بابت|شرح|توضیحات|علت)\s*:?\s*([^\n]{2,50})/.exec(t);
  out.purpose = purpose ? clean(purpose[1]).slice(0, 50) || null : null;

  // ── which of the user's accounts this row belongs to, when the card is not linked yet ──
  if (!s.accountId && out.bank) {
    const short = norm(out.bank.short);
    const named = d.accounts.filter((a) => !a.archived && a.kind === 'bank' && norm(a.name).includes(short));
    if (named.length === 1)
      out.account = { accountId: named[0].id, name: named[0].name, why: `${out.bank.via === 'sender' ? 'فرستنده پیامک' : 'متن پیامک'}: ${out.bank.name} — تنها حساب شما با این نام` };
  }

  const key = other && other.kind !== 'own-account' ? memoryKey(other.name ?? (other.kind === 'card' || other.kind === 'account' || other.kind === 'sheba' ? '' : other.label)) : '';
  out.memoryKey = key ? `party:${key}` : null;
  return out;
}

/** A short line for the transaction's note: «به: فروشگاه رفاه · بابت: اجاره». */
export function partiesNote(p: PartySuggestion): string {
  return [p.to && p.to.kind !== 'mine' ? `به: ${p.to.label}` : null, p.from && p.from.kind !== 'mine' ? `از: ${p.from.label}` : null, p.purpose ? `بابت: ${p.purpose}` : null].filter(Boolean).join(' · ');
}
