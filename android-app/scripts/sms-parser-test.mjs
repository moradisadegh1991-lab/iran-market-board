/** Locks the JS port of SmsParser to the behaviour documented in SmsParser.kt. */
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../www/sms-parser.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('bank formats:');

// ① تجارت — «برداشت: X ریال»
t('Tejarat withdrawal', () => {
  const r = P.parse('TejaratBank\nبرداشت: 1,250,000 ریال\nکارت: *4417\nمانده: 12,300,000');
  assert.ok(r, 'should parse');
  assert.equal(r.amount, 1250000);
  assert.equal(r.isWithdrawal, true);
  assert.equal(r.cardLast4, '4417');
  assert.equal(r.balance, 12300000);
});

// ② «مبلغ X ریال» — the Sepah shape, also used by other banks
t('"مبلغ X ریال" transfer', () => {
  const r = P.parse('انتقال وجه\nمبلغ 1,012,000 ریال\nمانده: 5,000,000');
  assert.ok(r);
  assert.equal(r.amount, 1012000);
  assert.equal(r.isWithdrawal, true);
  assert.equal(r.directionClear, true);
  // the text never says سپه, so the bank must not be claimed
  assert.equal(r.bankNameInSms, null, 'do not attribute an unnamed bank to Sepah');
});
t('Sepah named explicitly is attributed', () => {
  const r = P.parse('بانک سپه: واریز مبلغ 5,000,000 ریال');
  assert.equal(r.bankNameInSms, 'بانک سپه');
  assert.equal(r.channel, 'اینترنت‌بانک سپه');
  assert.equal(r.isWithdrawal, false);
});
t('a purchase with no direction verb is NOT booked as income', () => {
  // this silently counted as a deposit before: it inflated income and hid the spending
  const r = P.parse('تراکنش کارت شما در بانک ملت به مبلغ 2,400,000 ریال ثبت شد');
  assert.ok(r);
  assert.equal(r.directionClear, false, 'unstated direction must be flagged, not guessed');
  assert.notEqual(r.bankNameInSms, 'بانک سپه', 'a Melli message must not be filed under Sepah');
});

// ③ رسالت — sign before the number, and after it
t('Resalat -X', () => {
  const r = P.parse('123.456.789\n-100,000\nمانده: 2,500,000\nعنوان بانک رسالت');
  assert.ok(r);
  assert.equal(r.amount, 100000);
  assert.equal(r.isWithdrawal, true);
  assert.equal(r.balance, 2500000);
  assert.equal(r.bankNameInSms, 'رسالت');
});
t('Resalat X- (sign after)', () => {
  const r = P.parse('1.2.3\n9,000-\nمانده: 400,000');
  assert.ok(r);
  assert.equal(r.amount, 9000);
  assert.equal(r.isWithdrawal, true);
});
t('Resalat +X is a deposit', () => {
  const r = P.parse('1.2.3\n+250,000\nمانده: 900,000');
  assert.ok(r);
  assert.equal(r.isWithdrawal, false);
});

// ④ بلو — «X ریال از حساب شما پرید»
t('Blu withdrawal', () => {
  const r = P.parse('50,000 ریال از حساب شما پرید. مانده: 1,000,000');
  assert.ok(r);
  assert.equal(r.amount, 50000);
  assert.equal(r.isWithdrawal, true);
});

t('deposit keyword', () => {
  const r = P.parse('واریز 3,000,000 ریال به حساب شما\nمانده: 8,000,000');
  assert.ok(r);
  assert.equal(r.amount, 3000000);
  assert.equal(r.isWithdrawal, false);
});

console.log('normalisation:');
t('Persian digits are read as numbers', () => {
  const r = P.parse('برداشت: ۱٬۲۵۰٬۰۰۰ ریال'.replace(/٬/g, ','));
  assert.ok(r, 'Persian digits must parse');
  assert.equal(r.amount, 1250000);
});
t('Arabic ي/ك are unified', () => {
  assert.equal(P.normalize('واريز كارت'), 'واریز کارت');
});
t('bidi control marks are stripped', () => {
  assert.equal(P.normalize('\u200Eبرداشت\u202A'), 'برداشت');
});

console.log('rejections:');
t('amounts under 1000 are ignored', () => {
  assert.equal(P.parse('برداشت: 500 ریال'), null);
});
t('non-financial SMS is not a transaction', () => {
  assert.equal(P.classify('سلام، فردا جلسه ساعت ۱۰ است').kind, 'not');
});
t('OTP is never a transaction', () => {
  assert.equal(P.classify('رمز یکبار مصرف شما: 84213\nمبلغ 1,500,000 ریال').kind, 'not');
});
t('ad is never a transaction', () => {
  assert.equal(P.classify('جشنواره تخفیف تا 5,000,000 ریال اعتبار هدیه').kind, 'not');
});

console.log('classifier safety:');
t('phone-number-shaped amount goes to the user, not straight into the ledger', () => {
  assert.equal(P.isAbnormalAmount(989391500000), true);
  const c = P.classify('برداشت: 989391500000 ریال');
  assert.equal(c.kind, 'ambiguous', 'a 989… 12-digit value is a phone number, not money');
});
t('absurdly large amount is flagged, not auto-saved', () => {
  assert.equal(P.isAbnormalAmount(25000000000), true);
});
t('normal amount is confirmed', () => {
  assert.equal(P.isAbnormalAmount(1250000), false);
  assert.equal(P.classify('برداشت: 1,250,000 ریال\nمانده: 9,000,000').kind, 'confirmed');
});
t('financial-looking but unparsable goes to ambiguous with a guess', () => {
  const c = P.classify('تراکنش کارت شما در بانک ملت به مبلغ 2,400,000 ثبت شد');
  assert.equal(c.kind, 'ambiguous');
  assert.ok(c.guessedAmount >= 1000, 'should guess an amount');
});
t('both directions present ⇒ direction marked unclear', () => {
  const r = P.parse('برداشت و واریز همزمان 2,000,000 ریال');
  assert.ok(r);
  assert.equal(r.directionClear, false);
});

console.log(`\n${pass} checks passed\nSMS PARSER OK`);

console.log('\ndynamic-password (رمز پویا) — the double-counting case:');
{
  const otp = 'رمز پویا: 84213\nمبلغ 1,500,000 ریال\nمقصد: فروشگاه';
  assert.equal(P.classify(otp).kind, 'not', 'رمز پویا carries the amount but is not a transaction');
  // the real withdrawal that follows must still be recorded
  const real = P.parse('برداشت: 1,500,000 ریال\nکارت: *4417\nمانده: 8,000,000');
  assert.ok(real && real.amount === 1500000, 'the actual withdrawal must still parse');
  console.log('  ✓ OTP ignored, the withdrawal that follows still recorded (no double count)');
}
{
  const blu = P.parse('50,000 ریال از حساب شما پرید. مانده: 1,000,000');
  assert.equal(blu.amount, 50000, 'Blu amount, not the balance');
  console.log('  ✓ Blu amount read correctly (was reading the balance)');
}
console.log('\noperator messages (never a transaction):');
{
  const cases = [
    ['ایرانسل: کد فعال‌سازی بسته شما 48219 است', 'operator code'],
    ['همراه اول: شارژ شما 200,000 ریال افزایش یافت', 'operator top-up'],
    ['ایرانسل: اعتبار شما 200,000 ریال افزایش یافت. مانده اعتبار: 1,500,000', 'operator top-up with balance'],
    ['رایتل: بسته اینترنت 30 گیگ فعال شد', 'operator package'],
    ['کد: 84213', 'bare code, no sender hint'],
    ['رمز 918273', 'bare رمز'],
  ];
  for (const [body, label] of cases) {
    assert.equal(P.classify(body).kind, 'not', label + ' must not be a transaction');
    console.log('  ✓ ' + label);
  }
  // …but a real bank SMS must still get through
  assert.equal(P.classify('واریز 3,000,000 ریال به حساب شما حساب: 1234567890 مانده: 45,000,000').kind, 'confirmed');
  assert.equal(P.classify('برداشت: 1,250,000 ریال کارت: *4417 مانده: 9,000,000').kind, 'confirmed');
  console.log('  ✓ real bank messages still parse (the filter is not too greedy)');
}

console.log('\ntransfer fees and account numbers:');
{
  const fee = P.parse('برداشت: 5,000 ریال کارمزد انتقال وجه کارت: *4417');
  assert.ok(fee && fee.isFee === true, 'کارمزد must be flagged');
  const notFee = P.parse('برداشت: 1,250,000 ریال کارت: *4417');
  assert.equal(notFee.isFee, false, 'an ordinary withdrawal is not a fee');
  const acc = P.parse('واریز 3,000,000 ریال حساب: 1234567890');
  assert.equal(acc.accountNo, '1234567890', 'account number must be extracted');
  // an account number must NOT masquerade as a card, or every account is duplicated as one
  assert.equal(acc.cardLast4, null, 'account-only SMS must not produce a card');
  const both = P.parse('برداشت: 1,250,000 ریال کارت: *4417 مانده: 9,000,000');
  assert.equal(both.cardLast4, '4417', 'a real card must still be read');
  console.log('  ✓ fee flag, non-fee, account number, no phantom card');
}

console.log('\nSMS PARSER OK');
