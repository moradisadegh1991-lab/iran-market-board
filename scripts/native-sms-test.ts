/**
 * The phone decides with the app closed — in Java (android-app/native-plugin/java/BankSms.java) —
 * whether an arriving SMS is a bank transaction and which way the money went; the book is built
 * later by the JS parser. If the two disagreed, the notification would offer «درآمد» for a row the
 * app then reads as a withdrawal. This compiles the Java class with javac and runs it and the JS
 * parser (sms-parser.js + rowsFromMessages) over the same messages: the parser's own test corpus,
 * realistic bank messages, and 20,000 generated ones. Any difference fails.
 * Run: npx tsx scripts/native-sms-test.ts   (needs a JDK: javac/java on PATH)
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rowsFromMessages } from '../lib/finance/importers';
import { smsParser } from '../lib/finance/sms';
import rawParser from '@/android-app/www/sms-parser.js';

const ROOT = join(__dirname, '..');
const NATIVE = join(ROOT, 'android-app/native-plugin');

// ── corpus ──
const corpus: { body: string; address: string }[] = [];
const add = (body: string, address = '') => corpus.push({ body, address });

// 1) every message the parser's own tests use
const src = readFileSync(join(ROOT, 'android-app/scripts/sms-parser-test.mjs'), 'utf8');
for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
  const lit = (0, eval)(`'${m[1]}'`) as string;
  if (/\d/.test(lit) || /ریال|برداشت|واریز|کد|رمز/.test(lit)) add(lit);
}
// 2) realistic shapes
[
  'بانک ملت\nبرداشت از کارت ۶۱۰۴۳۳*****۴۴۱۷\nمبلغ: ۱,۲۵۰,۰۰۰ ریال\nمانده: ۱۲,۳۰۰,۰۰۰\n۱۴۰۵/۰۷/۰۶-۱۲:۳۰',
  'بانك ملي ايران\nواريز:3,000,000\nحساب:0123456789\nمانده:45,000,000\n0706-1230',
  'Bank Saman\nخرید 850,000 ریال کارت 1234 مانده 9,100,000',
  '*بانک پاسارگاد*\n-2,000,000\n123.456.789\nمانده: 7,500,000',
  'انتقال از حساب 1234567890 به مبلغ 5,000,000 ریال',
  'انتقال به حساب شما 12,000,000 ریال از طریق پایا',
  'تراکنش کارت شما به مبلغ 2,400,000 ریال ثبت شد',
  'خرید از فروشگاه 450,000 تومان کارت: *9921',
  'کسر کارمزد 6,000 ریال حساب: 9988776655',
  'افزایش موجودی 1,000,000 ریال',
  'رمز پویا: 84213 مبلغ 1,500,000 ریال',
  'ایرانسل: شارژ شما 200,000 ریال افزایش یافت',
  'سلام، شام میای؟',
  'کد تایید شما 12345',
  '⁧برداشت⁩ ‏1,250,000 ریال کارت ⁦*4417⁩',
  'برداشت 989121234567 ریال',
  'واریز 99,000,000,000 ریال',
  'پرداخت قبض برق 1,200,000 ریال موجودی: 3,400,000',
].forEach((b, i) => add(b, i % 3 ? '+98700717' : ''));

// 3) generated: fragments in random order with random separators and digit scripts
let seed = 0x5eed;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const toFa = (s: string, base: number) => s.replace(/\d/g, (d) => String.fromCharCode(base + Number(d)));
const number = (min = 1, max = 13) => {
  const len = min + Math.floor(rnd() * (max - min + 1));
  let s = String(1 + Math.floor(rnd() * 9));
  for (let i = 1; i < len; i++) s += Math.floor(rnd() * 10);
  const sep = pick([',', '،', '', ',']);
  if (sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const script = rnd();
  return script < 0.2 ? toFa(s, 0x06f0) : script < 0.27 ? toFa(s, 0x0660) : s;
};
const frags: (() => string)[] = [
  () => pick(['برداشت', 'خرید', 'انتقال از', 'کسر', 'پرداخت', 'انتقال وجه', 'واریز', 'واريز', 'انتقال به حساب شما', 'افزایش', 'تراکنش کارت شما', 'برداشت و واریز']) + pick([': ', ' ', ':']) + number(4),
  () => `${number(1, 12)} ریال از حساب شما پرید`,
  () => `مبلغ${pick([' ', '', ': '])}${number(3)} ${pick(['ریال', 'ريال', 'تومان'])}`,
  () => `${number(3)} ${pick(['ریال', 'ريال', 'تومان', ''])}`,
  () => pick([`کارت: *${number(4, 4).replace(/\D/g, '').slice(0, 4)}`, `603799******${String(1000 + Math.floor(rnd() * 9000))}`, `6104.33xx${String(1000 + Math.floor(rnd() * 9000))}`, `کارت ${String(1000 + Math.floor(rnd() * 9000))}`]),
  () => `حساب${pick([': ', ' ', ':'])}${String(Math.floor(rnd() * 1e10)).padStart(pick([5, 8, 10, 13]), '0')}`,
  () => `${pick(['مانده', 'موجودی'])}${pick([': ', ' ', ':'])}${number(4)}`,
  () => pick(['از طریق اینترنت بانک', 'از طريق موبایل‌بانک ملت', 'کانال: خودپرداز شعبه ۱۲', 'از طریق پایا و ساتنا و چیزهای بیشتر که از چهل حرف بلندتر است']),
  () => pick(['عنوان بانک ملت', 'عنوان بانک Resalat', 'بانک سپه', 'بانک ملی', 'Bank Mellat']),
  () => pick(['123.456.789', '1.2.3', '12.34']),
  () => pick(['-', '+']) + number(3),
  () => number(3) + pick(['-', '+', ' -']),
  () => pick(['رمز پویا: 84213', 'otp 1234', 'OTP: 9876', 'کد: 84213', 'رمز 918273', 'کد تأیید', 'جشنواره', 'لغو11']),
  () => pick(['ایرانسل', 'همراه اول', 'رایتل', 'اعتبار شما', 'بسته اینترنت', 'MCI', 'shatel']),
  () => pick(['کارمزد', 'کارمزد انتقال', 'هزینه انتقال']),
  () => pick(['1405/07/06', '۱۴۰۵/۰۷/۰۶ ۱۲:۳۰', '0706-1230', '12:30']),
  () => pick(['سلام', 'تراکنش', 'بانک', 'حساب', 'شما', 'ثبت شد', 'فروشگاه رفاه']),
];
const seps = ['\n', ' ', '\r\n', ' ', '‏', '⁦', '⁩', '. ', '\n\n', '\t', ' ', ' : '];
for (let i = 0; i < 20_000; i++) {
  const n = 1 + Math.floor(rnd() * 6);
  let body = '';
  for (let j = 0; j < n; j++) body += (j ? pick(seps) : rnd() < 0.1 ? pick(seps) : '') + pick(frags)();
  if (rnd() < 0.1) body += pick(seps);
  add(body, pick(['', '+98700717', 'Bank Mellat', '  ', '۹۸۷۰۰']));
}

// ── JS side ──
const v = (x: unknown) => (x === null || x === undefined ? '~' : String(x));
const jsRecord = ({ body, address }: { body: string; address: string }) => {
  const c = smsParser.classify(body) as { kind: string; guessedAmount?: number | null; guessedWithdrawal?: boolean };
  const t = (rawParser as unknown as { parse(b: string): Record<string, unknown> | null }).parse(body) as { amount: number; isWithdrawal: boolean; cardLast4: string | null; balance: number | null; channel: string | null; accountNo: string | null; isFee: boolean; bankNameInSms: string | null; directionClear: boolean } | null;
  const r = rowsFromMessages([{ body, address: address || undefined }], smsParser, '2026-10-02').rows[0];
  return [
    c.kind,
    v(c.guessedAmount),
    c.kind === 'ambiguous' ? v(c.guessedWithdrawal) : '~',
    t ? [t.amount, t.isWithdrawal, t.cardLast4, t.balance, t.channel, t.accountNo, t.isFee, t.bankNameInSms, t.directionClear].map(v).join('|') : '~',
    r ? [r.amountRial, r.direction, r.card, r.accountNo, r.bank, r.balanceRial, !!r.uncertainAmount].map(v).join('|') : '~',
  ].join('\u0001');
};

// ── Java side ──
const dir = mkdtempSync(join(tmpdir(), 'banksms-'));
try {
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, join(NATIVE, 'java/BankSms.java'), join(NATIVE, 'test/BankSmsCli.java')], { stdio: ['ignore', 'ignore', 'inherit'] });
  const input = corpus.map((m) => `${m.body}\u0002${m.address}`).join('\u0000') + '\u0000';
  const out = execFileSync('java', ['-cp', dir, 'ir.moradisadegh.marketboard.BankSmsCli'], { input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }).toString('utf8');
  const java = out.split('\u0000').slice(0, -1);
  assert.equal(java.length, corpus.length, 'one record per message');

  // past 2^53 JS numbers are inexact (and both sides call them abnormal): compare those as «huge»
  const huge = (rec: string) => rec.replace(/\d+(?:\.\d+)?e\+\d+|\d{16,}/g, (x) => (Number(x) > Number.MAX_SAFE_INTEGER ? 'huge' : x));
  const diffs: string[] = [];
  const kinds: Record<string, number> = {};
  corpus.forEach((m, i) => {
    const js = huge(jsRecord(m));
    kinds[js.split('\u0001')[0]] = (kinds[js.split('\u0001')[0]] ?? 0) + 1;
    if (js !== huge(java[i])) diffs.push(`${JSON.stringify(m.body)}\n   js:   ${JSON.stringify(js)}\n   java: ${JSON.stringify(java[i])}`);
  });
  if (diffs.length) {
    console.error(`${diffs.length} of ${corpus.length} messages differ; first ones:\n` + diffs.slice(0, 8).join('\n'));
    process.exit(1);
  }
  const rows = corpus.filter((m) => !jsRecord(m).endsWith('\u0001~')).length;
  console.log(`✓ Java and JS agree on all ${corpus.length} messages (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}; ${rows} would be queued)`);
  console.log('NATIVE SMS PARSER OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
