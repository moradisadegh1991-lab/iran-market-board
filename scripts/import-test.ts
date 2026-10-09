/**
 * Pins statement / SMS import (lib/finance/importers.ts + readers.ts). Real files go through the
 * same SheetJS reader the page uses; the PDF path is covered by a synthetic layout here and by a
 * real Chromium-printed PDF in the browser check. Run: npx tsx scripts/import-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { jalaliToIso } from '../lib/jalali';
import {
  choicesFor,
  commitStaged,
  detectColumns,
  flipRtl,
  dismissStaged,
  enqueue,
  isDuplicate,
  memoryKey,
  parseCsv,
  parseDate,
  parseMoney,
  rowsFromMessages,
  rowsFromSms,
  rowsFromTable,
  smsDate,
  splitSms,
  suggestCategory,
  tableFromPdf,
  type PdfItem,
} from '../lib/finance/importers';
import { decodeText, readStatement, ReadError } from '../lib/finance/readers';
import { smsParser } from '../lib/finance/sms';
import { accountBalances } from '../lib/finance/calc';
import { emptyData, normalizeData, type Staged } from '../lib/finance/model';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};
const J = (m: number, d: number, y = 1405) => jalaliToIso(y, m, d);
const TODAY = J(7, 10);
const ab = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

(async () => {
  await ok('money and date cells in the shapes Iranian banks export', () => {
    assert.deepEqual(parseMoney('1,250,000'), { value: 1250000, negative: false });
    assert.deepEqual(parseMoney('(1,250,000)'), { value: 1250000, negative: true });
    assert.deepEqual(parseMoney('۱٬۲۵۰٬۰۰۰-'), { value: 1250000, negative: true });
    assert.deepEqual(parseMoney('-۵۰۰'), { value: 500, negative: true });
    assert.deepEqual(parseMoney('2,000,000 ریال'), { value: 2000000, negative: false });
    assert.equal(parseMoney(''), null);
    assert.equal(parseMoney('کارمزد'), null);
    assert.equal(parseDate('1405/06/20'), J(6, 20));
    assert.equal(parseDate('۱۴۰۵/۰۶/۲۰ ۱۴:۳۵'), J(6, 20));
    assert.equal(parseDate('05/06/20'), J(6, 20));
    assert.equal(parseDate('99/12/30'), J(12, 30, 1399)); // 1399 is a leap year
    assert.equal(parseDate('1405/12/30'), null); // 1405 is not
    assert.equal(parseDate('14050620'), J(6, 20));
    assert.equal(parseDate('2026-09-11'), '2026-09-11');
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(parseDate('1405/13/01'), null);
    assert.equal(parseDate('شرح'), null);
  });

  // A Mellat-style export: title rows, unit in the header, newest first, a totals row at the end.
  const mellat: (string | number)[][] = [
    ['صورتحساب سپرده کوتاه مدت'],
    ['شماره حساب: 1234567890', '', 'از تاریخ 1405/06/01 تا 1405/06/31'],
    ['ردیف', 'تاریخ', 'زمان', 'شرح', 'شماره پیگیری', 'مبلغ برداشت (ریال)', 'مبلغ واریز (ریال)', 'مانده (ریال)'],
    [4, '1405/06/25', '18:02', 'خرید کالا فروشگاه افق کوروش', '771204', '3,450,000', '', '186,550,000'],
    [3, '1405/06/22', '09:15', 'واریز حقوق شهریور شرکت کاویان', '771100', '', '150,000,000', '190,000,000'],
    [2, '۱۴۰۵/۰۶/۱۰', '۱۱:۴۰', 'پرداخت قبض برق', '۷۷۰۹۰۰', '۸۵۰٬۰۰۰', '', '۴۰٬۰۰۰٬۰۰۰'],
    [1, '1405/06/03', '08:00', 'انتقال به كارت 6037', '770800', '10,000,000', '', '40,850,000'],
    ['', '', '', 'جمع', '', '14,300,000', '150,000,000', ''],
  ];

  await ok('Excel (real .xlsx through SheetJS): header found, rial, chronological, balance confirms direction', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['خلاصه'], ['هیچ']]), 'Sheet0');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mellat), 'گردش');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { table, format } = await readStatement('mellat.xlsx', buf);
    assert.equal(format, 'excel');
    const map = detectColumns(table)!;
    assert.equal(map.headerRow, 2);
    assert.equal(map.unit, 'rial');
    const r = rowsFromTable(table, { accountId: 'a-bank', now: 1 });
    assert.equal(r.rows.length, 4);
    assert.equal(r.skipped, 1, 'the totals row is skipped, not imported');
    assert.deepEqual(r.rows.map((x) => x.date), [J(6, 3), J(6, 10), J(6, 22), J(6, 25)]);
    assert.deepEqual(r.rows.map((x) => x.direction), ['out', 'out', 'in', 'out']);
    assert.deepEqual(r.rows.map((x) => x.amountRial), [10_000_000, 850_000, 150_000_000, 3_450_000]);
    assert.equal(r.rows[0].why, 'ستون برداشت/واریز', 'the oldest row has no previous balance to check against');
    assert.ok(r.rows.slice(1).every((x) => x.why === 'ستون جدول و تغییر مانده هر دو'));
    assert.equal(r.rows[1].ref, '770900');
    assert.equal(r.rows[1].description, 'پرداخت قبض برق');
    assert.equal(r.rows[3].balanceRial, 186_550_000);
    assert.equal(r.rows[0].description, 'انتقال به کارت 6037', 'Arabic kaf normalised');
    assert.deepEqual(r.warnings, []);
    // same file again → same ids, so nothing is queued twice
    const again = rowsFromTable(table, { accountId: 'a-bank', now: 2 });
    assert.deepEqual(again.rows.map((x) => x.id), r.rows.map((x) => x.id));
  });

  await ok('Excel with numeric and date-typed cells (not text)', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      [new Date(2026, 8, 10), 'ATM', 2_000_000, '', 8_000_000],
      [new Date(2026, 8, 12), 'Salary', '', 50_000_000, 58_000_000],
    ], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 's');
    const { table } = await readStatement('en.xls', XLSX.write(wb, { type: 'array', bookType: 'xls' }) as ArrayBuffer);
    const r = rowsFromTable(table);
    assert.deepEqual(r.rows.map((x) => [x.date, x.direction, x.amountRial]), [['2026-09-10', 'out', 2_000_000], ['2026-09-12', 'in', 50_000_000]]);
    assert.ok(r.warnings.some((w) => /ریال فرض شد/.test(w)), 'no unit in the file → says so');
  });

  await ok('toman header is converted once; the caller can override the unit', () => {
    const t = [['تاریخ', 'شرح', 'برداشت (تومان)', 'واریز (تومان)'], ['1405/07/01', 'نانوایی', '50,000', '']];
    assert.equal(rowsFromTable(t).rows[0].amountRial, 500_000);
    assert.equal(rowsFromTable(t, { unit: 'rial' }).rows[0].amountRial, 50_000);
    const noUnit = [['تاریخ', 'شرح', 'برداشت', 'واریز'], ['1405/07/01', 'نانوایی', '50,000', '']];
    assert.equal(rowsFromTable(noUnit, { unit: 'toman' }).rows[0].amountRial, 500_000);
    assert.equal(rowsFromTable(noUnit, { unit: 'toman' }).warnings.length, 0);
  });

  await ok('CSV, signed amount column, same-day rows newest-first: order taken from the balance', () => {
    const csv = '﻿تاریخ;شرح;مبلغ;مانده\n1405/07/05;"خرید; اسنپ";-200,000;1,300,000\n1405/07/05;واریز پایا;1,000,000;1,500,000\n1405/07/05;کارمزد;-5,000;500,000\n';
    const t = parseCsv(csv);
    assert.equal(t[1][1], 'خرید; اسنپ', 'quoted separator stays in the cell');
    const r = rowsFromTable(t);
    assert.deepEqual(r.rows.map((x) => [x.description, x.direction]), [['کارمزد', 'out'], ['واریز پایا', 'in'], ['خرید; اسنپ', 'out']]);
    assert.equal(r.rows[0].fee, true);
    assert.ok(r.rows[1].why.includes('مانده'));
  });

  await ok('no sign, no debit/credit, no balance → direction stays null (never guessed)', () => {
    const t = [['تاریخ', 'شرح', 'مبلغ'], ['1405/07/01', 'تراکنش', '1,000,000'], ['1405/07/02', 'تراکنش', '2,000,000']];
    const r = rowsFromTable(t);
    assert.ok(r.rows.every((x) => x.direction === null));
    assert.ok(r.warnings.some((w) => /جهت مشخص نداشت/.test(w)));
  });

  await ok('unsigned amount + running balance → direction from the balance only', () => {
    const t = [['تاریخ', 'شرح', 'مبلغ', 'مانده'], ['1405/07/01', 'a', '1,000,000', '9,000,000'], ['1405/07/02', 'b', '2,000,000', '7,000,000'], ['1405/07/03', 'c', '500,000', '7,500,000']];
    const r = rowsFromTable(t);
    assert.deepEqual(r.rows.map((x) => x.direction), [null, 'out', 'in']);
    assert.equal(r.rows[1].why, 'تغییر مانده حساب');
  });

  await ok('debit column contradicted by the balance → left undecided, with a warning', () => {
    const t = [['تاریخ', 'برداشت', 'واریز', 'مانده'], ['1405/07/01', '1,000', '', '10,000'], ['1405/07/02', '1,000', '', '11,000']];
    const r = rowsFromTable(t);
    assert.equal(r.rows[1].direction, null);
    assert.match(r.rows[1].why, /نمی‌خوانند/);
    assert.ok(r.warnings.some((w) => /جور نبود/.test(w)));
  });

  await ok('no header → a clear message, nothing imported', () => {
    const r = rowsFromTable([['a', 'b'], ['1', '2']]);
    assert.equal(r.rows.length, 0);
    assert.match(r.warnings[0], /سرستون/);
  });

  await ok('Windows-1256 CSV is decoded', () => {
    const dec = new TextDecoder('windows-1256');
    const enc = new Map<string, number>();
    for (let b = 0; b < 256; b++) enc.set(dec.decode(new Uint8Array([b])), b);
    const text = 'تاریخ,شرح,برداشت\n1405/07/01,نانوایی,10000\n';
    // cp1256 has only the Arabic yeh (ي); the importer normalises it to the Persian one
    const bytes = new Uint8Array([...text.replace(/ی/g, 'ي')].map((ch) => enc.get(ch) ?? 63));
    assert.ok(!bytes.includes(63), 'every character encodable');
    const t = parseCsv(decodeText(ab(bytes)));
    const r = rowsFromTable(t);
    assert.equal(r.rows[0].description, 'نانوایی');
    assert.equal(r.rows[0].direction, 'out');
  });

  await ok('PDF layout: words assigned by header column, empty cells, wrapped descriptions, repeated header', () => {
    // RTL page: columns from right to left — تاریخ | شرح | برداشت | واریز | مانده
    const col = { date: 500, desc: 380, out: 260, in: 160, bal: 50 };
    const hdr = (y: number): PdfItem[] => [
      { str: 'تاریخ', x: col.date, y, w: 30 },
      { str: 'شرح', x: col.desc, y, w: 25 },
      { str: 'برداشت', x: col.out + 4, y, w: 22 },
      { str: 'مبلغ', x: col.out + 30, y, w: 20 }, // two words of one header cell
      { str: 'واریز', x: col.in, y, w: 30 },
      { str: 'مانده', x: col.bal, y, w: 30 },
    ];
    const page1: PdfItem[] = [
      { str: 'گردش حساب', x: 300, y: 800, w: 60 },
      ...hdr(760),
      { str: '1405/07/01', x: col.date, y: 740, w: 45 },
      { str: 'خرید از', x: col.desc, y: 740, w: 40 },
      { str: '1,200,000', x: col.out, y: 740, w: 45 },
      { str: '8,800,000', x: col.bal, y: 740, w: 45 },
      { str: 'فروشگاه رفاه', x: col.desc, y: 728, w: 50 }, // wrapped line
      { str: '1405/07/02', x: col.date, y: 712, w: 45 },
      { str: 'واریز پایا', x: col.desc, y: 712, w: 40 },
      { str: '5,000,000', x: col.in, y: 712.5, w: 45 }, // baseline jitter
      { str: '13,800,000', x: col.bal, y: 712, w: 50 },
    ];
    const page2: PdfItem[] = [...hdr(780), { str: '1405/07/03', x: col.date, y: 760, w: 45 }, { str: 'قبض گاز', x: col.desc, y: 760, w: 40 }, { str: '300,000', x: col.out, y: 760, w: 40 }, { str: '13,500,000', x: col.bal, y: 760, w: 50 }];
    const table = tableFromPdf([page1, page2]);
    const r = rowsFromTable(table);
    assert.deepEqual(r.rows.map((x) => [x.date, x.direction, x.amountRial]), [[J(7, 1), 'out', 1_200_000], [J(7, 2), 'in', 5_000_000], [J(7, 3), 'out', 300_000]]);
    assert.equal(r.rows[0].description, 'خرید از فروشگاه رفاه');
    assert.equal(r.rows[2].why, 'ستون جدول و تغییر مانده هر دو', 'the balance walk continues across pages');
  });

  await ok('PDF: a tall row whose other cells are vertically centred keeps both description lines', () => {
    const h: PdfItem[] = [{ str: 'تاریخ', x: 500, y: 700, w: 30 }, { str: 'شرح', x: 380, y: 700, w: 25 }, { str: 'برداشت', x: 260, y: 700, w: 30 }, { str: 'مانده', x: 50, y: 700, w: 30 }];
    const row = (y: number, date: string, amt: string, bal: string, d1: string, d2?: string): PdfItem[] => [
      { str: date, x: 500, y, w: 45 },
      { str: amt, x: 260, y, w: 45 },
      { str: bal, x: 50, y, w: 45 },
      ...(d2 ? [{ str: d1, x: 380, y: y + 6, w: 60 }, { str: d2, x: 380, y: y - 6, w: 60 }] : [{ str: d1, x: 380, y, w: 60 }]),
    ];
    const t = tableFromPdf([[...h, ...row(670, '1405/07/01', '100,000', '900,000', 'خرید'), ...row(640, '1405/07/02', '200,000', '700,000', 'انتقال به', 'علی رضایی'), ...row(610, '1405/07/03', '50,000', '650,000', 'کارمزد')]]);
    assert.deepEqual(rowsFromTable(t).rows.map((x) => x.description), ['خرید', 'انتقال به علی رضایی', 'کارمزد']);
  });

  // A real PDF printed by Chromium (RTL table, embedded Persian font, 2 pages, thead repeated,
  // a description wrapped over two lines with the other cells centred, an opening-balance row,
  // a totals row and a footer note). pdf.js returns its Persian as single glyphs in VISUAL order
  // and as Arabic presentation forms — the same shape many bank PDFs have.
  const fixture = (f: string) => { const b = fs.readFileSync(`${__dirname}/fixtures/${f}`); return ab(b); };
  await ok('real PDF (Chromium-printed, glyph-level visual-order text) → 45 rows, all balance-confirmed', async () => {
    const { table, pages, format } = await readStatement('statement.pdf', fixture('statement-chromium.pdf'));
    assert.equal(format, 'pdf');
    assert.equal(pages, 2);
    assert.ok(table.some((r) => r.join(' ').includes('بانک نمونه — گردش حساب جاری')), 'title read in logical order');
    const r = rowsFromTable(table, { accountId: 'a' });
    assert.equal(r.rows.length, 45);
    assert.ok(r.rows.every((x) => x.why === 'ستون جدول و تغییر مانده هر دو'), 'every row, the first via the «مانده از قبل» row');
    assert.equal(r.rows[0].date, J(7, 1));
    assert.deepEqual([r.rows[0].amountRial, r.rows[0].direction, r.rows[0].ref, r.rows[0].description], [120_000, 'out', '880000', 'پرداخت قبض گاز']);
    assert.equal(r.rows[7].description, 'انتقال وجه پایا به حساب آقای محمد رضایی بابت قسط اجاره ماه شهریور');
    assert.equal(r.rows[44].description, 'پرداخت قبض گاز', 'the footer note is not glued to the last row');
    assert.equal(r.rows[44].balanceRial, 91_820_000);
  });

  await ok('password-protected PDF: asks for the password, rejects a wrong one, opens with the right one', async () => {
    const f = fixture('statement-locked.pdf');
    await assert.rejects(readStatement('s.pdf', f), (e) => e instanceof ReadError && e.code === 'password' && /رمز دارد/.test(e.message));
    await assert.rejects(readStatement('s.pdf', f, '1111111111'), (e) => e instanceof ReadError && e.code === 'password' && /درست نیست/.test(e.message));
    const { table } = await readStatement('s.pdf', f, '0012345678');
    assert.equal(rowsFromTable(table).rows.length, 45);
  });

  await ok('flipRtl: visual ↔ logical keeps numbers, dates and times intact', () => {
    for (const s of ['انتقال به کارت 6037', 'از تاریخ 1405/06/01 تا 1405/06/31', 'مبلغ 1,250,000 ریال ساعت 14:35', 'خرید']) assert.equal(flipRtl(flipRtl(s)), s);
    assert.equal(flipRtl('6037 تراک هب لاقتنا'), 'انتقال به کارت 6037');
  });

  await ok('SMS paste: split, verbs, OTP ignored, both verbs → ask, toman SMS converted', () => {
    const paste = [
      'TejaratBank\nبرداشت: 1,250,000 ریال\nکارت: *4417\nمانده: 12,300,000\n0705-14:35',
      'رمز پویا: 84213\nمبلغ 1,500,000 ریال',
      'واریز 3,000,000 ریال به حساب شما\nمانده: 8,000,000\n1405/07/06',
      'برداشت و واریز همزمان 2,000,000 ریال',
      'سلام، فردا جلسه ساعت ۱۰ است',
      'بانک نمونه\nبرداشت 120,000 تومان\nمانده 4,000,000 تومان',
    ].join('\n\n');
    assert.equal(splitSms(paste).length, 6);
    const r = rowsFromSms(paste, smsParser, TODAY, { accountId: 'a-bank', now: 1 });
    assert.equal(r.ignored.length, 2);
    assert.deepEqual(r.rows.map((x) => [x.direction, x.amountRial]), [['out', 1_250_000], ['in', 3_000_000], [null, 2_000_000], ['out', 1_200_000]]);
    assert.equal(r.rows[0].date, J(7, 5), 'MMDD-HH:MM in the current Jalali year');
    assert.equal(r.rows[0].time, '14:35');
    assert.equal(r.rows[0].card, '4417');
    assert.equal(r.rows[1].date, J(7, 6));
    assert.equal(r.rows[2].date, null, 'no date in the SMS → the user picks one');
    assert.match(r.rows[2].why, /هم واژه برداشت دارد هم واریز/);
    assert.equal(r.rows[3].balanceRial, 40_000_000);
  });

  await ok('ambiguous SMS (no verb) is queued without a direction', () => {
    const r = rowsFromSms('تراکنش کارت شما در بانک ملت به مبلغ 2,400,000 ریال ثبت شد', smsParser, TODAY);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].direction, null);
    assert.equal(r.rows[0].why, 'پیامک نگفته برداشت است یا واریز');
    assert.equal(r.rows[0].amountRial, 2_400_000);
  });

  await ok('phone inbox: receive time gives the date when the SMS has none; personal SMS ignored', () => {
    const at = Date.UTC(2026, 9, 1, 20, 45); // 1 Oct 2026 20:45 UTC = 2 Oct 00:15 Tehran
    const r = rowsFromMessages(
      [
        { body: 'واریز 3,000,000 ریال به حساب شما', at },
        { body: 'سلام، فردا جلسه ساعت ۱۰ است', at },
        { body: 'برداشت: 1,250,000 ریال\n1405/07/06', at }, // the date in the text wins
      ],
      smsParser,
      TODAY,
    );
    assert.equal(r.ignored.length, 1);
    assert.deepEqual(r.rows.map((x) => [x.date, x.time]), [['2026-10-02', '00:15'], [J(7, 6), '00:15']]);
    // the same SMS read twice from the inbox is one queue row; the same text received twice is two
    assert.equal(rowsFromMessages([{ body: 'واریز 3,000,000 ریال', at }], smsParser, TODAY).rows[0].id, rowsFromMessages([{ body: 'واریز 3,000,000 ریال', at }], smsParser, TODAY).rows[0].id);
    assert.notEqual(rowsFromMessages([{ body: 'واریز 3,000,000 ریال', at }], smsParser, TODAY).rows[0].id, rowsFromMessages([{ body: 'واریز 3,000,000 ریال', at: at + 60_000 }], smsParser, TODAY).rows[0].id);
  });

  await ok('SMS date without a year never lands in the future', () => {
    assert.equal(smsDate('خرید 0712-10:00', TODAY), J(7, 12, 1404));
    assert.equal(smsDate('خرید 0709-10:00', TODAY), J(7, 9));
    assert.equal(smsDate('خرید', TODAY), null);
  });

  await ok('confirming: kinds limited by the source direction, transfers both ways, category remembered', () => {
    const d = emptyData(TODAY);
    d.accounts.push({ id: 'a-bank', name: 'ملت', kind: 'bank', openingRial: 40_850_000 + 10_000_000, openedOn: J(6, 1) });
    const table = mellat.map((r) => r.map(String));
    const st = rowsFromTable(table, { accountId: 'a-bank', now: 1 });
    assert.equal(enqueue(d, st.rows), 4);
    assert.equal(enqueue(d, st.rows), 0, 'same file twice → nothing new');
    const [transfer, bill, salary, shop] = d.inbox;
    assert.deepEqual(choicesFor(salary), ['income', 'transfer-in', 'lend-in']);
    assert.match(commitStaged(d, salary.id, { choice: 'expense', accountId: 'a-bank' })!, /جهت/);
    assert.match(commitStaged(d, transfer.id, { choice: 'transfer-out', accountId: 'a-bank' })!, /حساب دیگر/);
    assert.equal(d.txns.length, 0, 'a refused commit changes nothing');
    assert.equal(commitStaged(d, transfer.id, { choice: 'transfer-out', accountId: 'a-bank', otherAccountId: 'a-cash' }), null);
    assert.equal(commitStaged(d, bill.id, { choice: 'expense', accountId: 'a-bank', categoryId: 'c-bills' }), null);
    assert.equal(commitStaged(d, salary.id, { choice: 'income', accountId: 'a-bank', categoryId: 'i-salary' }), null);
    assert.equal(commitStaged(d, shop.id, { choice: 'expense', accountId: 'a-bank', categoryId: 'i-salary' }), null);
    assert.equal(d.txns[3].categoryId, null, 'an income category on an expense is dropped, not stored');
    assert.equal(d.inbox.length, 0);
    const bal = accountBalances(d);
    assert.equal(bal['a-bank'], 186_550_000, 'the book now agrees with the statement’s last balance');
    assert.equal(bal['a-cash'], 10_000_000);
    assert.equal(d.txns[0].src, 'statement');
    assert.equal(d.txns[1].ref, '770900');
    assert.equal(d.catMemory[memoryKey('پرداخت قبض برق')], 'c-bills');
    // next month's bill from the same payee is pre-filled from memory
    const next: Staged = { ...bill, id: 'x', date: J(7, 10), description: 'پرداخت قبض برق', raw: '' };
    d.catMemory[memoryKey(next.description)] = 'c-home'; // the user's own choice beats keywords
    assert.equal(suggestCategory(d, next), 'c-home');
    delete d.catMemory[memoryKey(next.description)];
    assert.equal(suggestCategory(d, next), 'c-bills');
    assert.equal(suggestCategory(d, { ...next, description: 'واریز حقوق', direction: 'in' }), 'i-salary');
    assert.equal(suggestCategory(d, { ...next, description: 'حقوق', direction: 'out' }), null, 'keyword for the wrong direction is not used');
  });

  await ok('incoming transfer moves money from the other account; dates required when missing', () => {
    const d = emptyData(TODAY);
    d.accounts.push({ id: 'a-bank', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: J(1, 1) });
    const s = rowsFromSms('واریز 3,000,000 ریال به حساب شما', smsParser, TODAY, { accountId: 'a-bank' }).rows[0];
    enqueue(d, [s]);
    assert.match(commitStaged(d, s.id, { choice: 'transfer-in', accountId: 'a-bank', otherAccountId: 'a-cash' })!, /تاریخ/);
    assert.equal(commitStaged(d, s.id, { choice: 'transfer-in', accountId: 'a-bank', otherAccountId: 'a-cash', date: J(7, 1) }), null);
    const bal = accountBalances(d);
    assert.deepEqual([bal['a-bank'], bal['a-cash']], [3_000_000, -3_000_000]);
    assert.equal(d.txns[0].src, 'sms');
  });

  await ok('duplicates of hand-entered transactions are flagged; dismiss removes rows', () => {
    const d = emptyData(TODAY);
    d.txns.push({ id: 't1', date: J(7, 1), kind: 'expense', amountRial: 500_000, accountId: 'a-cash' });
    const s: Staged = { id: 's1', source: 'sms', date: J(7, 1), amountRial: 500_000, direction: 'out', why: '', description: '', raw: '', importedAt: 0 };
    assert.equal(isDuplicate(d, s), true);
    assert.equal(isDuplicate(d, { ...s, direction: 'in' }), false);
    assert.equal(isDuplicate(d, { ...s, direction: null }), false, 'undecided rows are not auto-matched');
    assert.equal(isDuplicate(d, { ...s, amountRial: 500_001 }), false);
    enqueue(d, [s, { ...s, id: 's2' }]);
    dismissStaged(d, ['s1']);
    assert.deepEqual(d.inbox.map((x) => x.id), ['s2']);
  });

  await ok('inbox and category memory survive the backup round-trip; old backups load', () => {
    const d = emptyData(TODAY);
    d.inbox.push({ id: 's1', source: 'statement', date: null, amountRial: 1000, direction: null, why: 'x', description: 'y', raw: 'z', importedAt: 1 });
    d.catMemory['قبض برق'] = 'c-bills';
    const back = normalizeData(JSON.parse(JSON.stringify(d)), TODAY);
    assert.deepEqual(back.inbox, d.inbox);
    assert.deepEqual(back.catMemory, d.catMemory);
    const old = JSON.parse(JSON.stringify(d));
    delete old.inbox;
    delete old.catMemory;
    const o = normalizeData(old, TODAY);
    assert.deepEqual([o.inbox, o.catMemory], [[], {}]);
  });

  console.log(`\n${n} import checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
