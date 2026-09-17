/* ============================================================
   sms-parser.js — پارسر پیامک بانکی ایرانی
   منتقل‌شده از SmsParser.kt / SmsClassifier پروژه ExpenseTracker.
   منطق، کلیدواژه‌ها، regexها و آستانه‌ها بدون تغییر.

   دو نکته که در انتقال از Kotlin به JS باید مراقبشان بود و
   در scripts/sms-parser-test.mjs قفل شده‌اند:
     • Regex در Kotlin با MULTILINE کار می‌کند؛ اینجا پرچم m لازم است.
     • `substringAfter` در Kotlin اگر کلیدواژه نباشد کل رشته را برمی‌گرداند،
       ولی اینجا کلیدواژه همیشه پیدا شده است، پس split کافی است.
   ============================================================ */
(function () {
  'use strict';

  var withdrawKeys = ['برداشت', 'خرید', 'انتقال از', 'کسر', 'پرداخت', 'انتقال وجه', 'حساب شما پرید'];
  /**
   * Keywords whose wording puts the amount BEFORE them ("۵۰٬۰۰۰ ریال از حساب شما پرید").
   * The original Kotlin always searched after the keyword, so for these it skipped the
   * amount and matched the balance instead — a Blu withdrawal of ۵۰٬۰۰۰ was recorded as
   * the ۱٬۰۰۰٬۰۰۰ balance. This is the one intentional deviation from SmsParser.kt, and
   * the same fix is worth making in the Kotlin app.
   */
  var amountBeforeKeys = ['حساب شما پرید'];
  var depositKeys = ['واریز', 'واريز', 'انتقال به حساب شما', 'افزایش'];

  var resalatRx = /^([+\-])([\d,،]+)\s*$|^([\d,،]+)\s*([+\-])\s*$/m;
  var mablaghRx = /مبلغ\s*([\d,،]+)\s*ریال/;
  var kwAmountRx = /([\d,،]{4,})/;
  var balanceRx = /(?:مانده|موجودی)\s*:?\s*([\d,،]+)/;
  var cardRx = /\d{4,6}[*.x]{2,}(\d{4})|کارت\s*:?\s*\*?(\d{4})/;
  var accountRx = /حساب\s*:?\s*(\d{6,})/;
  var channelRx = /(?:از\s*طریق|از\s*طريق|کانال)\s*:?\s*(.{2,40})/;
  var bankNameRx = /عنوان\s*بانک\s+([A-Za-z\u0600-\u06FF]{2,30})/;
  var resalatRefRx = /^\d+\.\d+\.\d+/;

  /** Persian/Arabic digits → ASCII, unify ي/ك, drop bidi control marks. */
  function normalize(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i], code = s.charCodeAt(i);
      if (c >= '۰' && c <= '۹') out += String.fromCharCode(48 + (code - 0x06F0));
      else if (c >= '٠' && c <= '٩') out += String.fromCharCode(48 + (code - 0x0660));
      else if (c === 'ي') out += 'ی';
      else if (c === 'ك') out += 'ک';
      else if (code >= 0x200E && code <= 0x200F) continue;
      else if (code >= 0x202A && code <= 0x202E) continue;
      else if (code >= 0x2066 && code <= 0x2069) continue;
      else out += c;
    }
    return out;
  }

  function toCleanLong(s) {
    if (s === null || s === undefined) return null;
    var v = String(s).replace(/,/g, '').replace(/،/g, '').trim();
    if (!/^\d+$/.test(v)) return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function firstGroup(rx, s, idx) {
    var m = rx.exec(s);
    return m && m[idx] ? m[idx] : null;
  }

  function parseResalat(n) {
    var m = resalatRx.exec(n);
    if (!m) return null;
    var sign = m[1] || m[4] || '';
    var numStr = m[2] || m[3] || '';
    var amount = toCleanLong(numStr);
    if (amount === null || amount < 1000) return null;
    var ref = resalatRefRx.exec(n.trim());
    var ref4 = ref ? ref[0].replace(/\./g, '').slice(-4) : null;
    return {
      amount: amount,
      isWithdrawal: sign === '-',
      cardLast4: ref4,
      balance: toCleanLong(firstGroup(balanceRx, n, 1)),
      channel: null,
      bankNameInSms: (firstGroup(bankNameRx, n, 1) || '').trim() || null,
      directionClear: true
    };
  }

  function parseSepah(n) {
    var amount = toCleanLong(firstGroup(mablaghRx, n, 1));
    if (amount === null || amount < 1000) return null;
    var isWithdrawal = withdrawKeys.some(function (k) { return n.indexOf(k) >= 0; });
    return {
      amount: amount,
      isWithdrawal: isWithdrawal,
      cardLast4: null,
      balance: toCleanLong(firstGroup(balanceRx, n, 1)),
      channel: 'اینترنت‌بانک سپه',
      bankNameInSms: 'بانک سپه',
      directionClear: true
    };
  }

  function parseKeyword(n) {
    var isWithdrawal = withdrawKeys.some(function (k) { return n.indexOf(k) >= 0; });
    var isDeposit = depositKeys.some(function (k) { return n.indexOf(k) >= 0; });
    if (!isWithdrawal && !isDeposit) return null;

    var all = withdrawKeys.concat(depositKeys);
    var keyword = null;
    for (var i = 0; i < all.length; i++) if (n.indexOf(all[i]) >= 0) { keyword = all[i]; break; }
    if (keyword === null) return null;

    var amount;
    if (amountBeforeKeys.indexOf(keyword) >= 0) {
      // take the LAST 4+ digit number before the keyword — the one closest to it
      var before = n.slice(0, n.indexOf(keyword));
      var nums = before.match(/[\d,،]{4,}/g);
      amount = nums && nums.length ? toCleanLong(nums[nums.length - 1]) : null;
    } else {
      amount = toCleanLong(firstGroup(kwAmountRx, n.slice(n.indexOf(keyword) + keyword.length), 1));
    }
    if (amount === null || amount < 1000) return null;

    var cm = cardRx.exec(n);
    var card = cm ? (cm[1] || cm[2] || null) : null;
    var acc = firstGroup(accountRx, n, 1);
    var chan = firstGroup(channelRx, n, 1);

    return {
      amount: amount,
      isWithdrawal: isWithdrawal && !isDeposit,
      cardLast4: card || (acc ? acc.slice(-4) : null),
      balance: toCleanLong(firstGroup(balanceRx, n, 1)),
      channel: chan ? chan.trim().slice(0, 40) : null,
      bankNameInSms: null,
      directionClear: !(isWithdrawal && isDeposit)
    };
  }

  function parse(body) {
    var n = normalize(body);
    if (resalatRx.test(n)) return parseResalat(n);
    if (mablaghRx.test(n)) return parseSepah(n);
    return parseKeyword(n);
  }

  // ── classifier ──
  var financialHints = ['ریال', 'ريال', 'تومان', 'مانده', 'موجودی', 'حساب', 'کارت',
    'برداشت', 'واریز', 'واريز', 'خرید', 'انتقال', 'تراکنش', 'بانک'];
  var spamHints = ['رمز یکبار', 'رمز پویا', 'رمز دوم', 'کد تایید', 'کد فعالسازی', 'otp', 'تخفیف', 'جشنواره',
    'اقساط وام', 'کد ورود', 'لغو11', 'لغو 11'];
  var bigNumberRx = /[\d,،]{5,}/g;

  /** A 12-digit 989… value is a phone number, not money; and no personal transaction is 2bn toman. */
  function isAbnormalAmount(amount) {
    var s = String(amount);
    return (s.length === 12 && s.indexOf('989') === 0) || amount > 20000000000;
  }

  function classify(body) {
    var lower0 = String(body).toLowerCase();
    /**
     * OTP first, parsing second — the reverse of SmsClassifier.kt.
     * Iranian dynamic-password messages ("رمز پویا: ۱۲۳۴۵ مبلغ ۱٬۵۰۰٬۰۰۰ ریال") carry the
     * amount, so the original's parse-first order recorded them as real transactions. The
     * actual withdrawal SMS then arrives too, and every card payment is counted twice.
     * 'رمز پویا' and 'رمز دوم' were also missing from the hint list.
     * Second intentional deviation from the Kotlin; worth porting back to it.
     */
    if (spamHints.some(function (h) { return lower0.indexOf(h) >= 0; })) return { kind: 'not' };

    var tx = parse(body);
    if (tx) {
      if (isAbnormalAmount(tx.amount)) return { kind: 'ambiguous', guessedAmount: tx.amount, guessedWithdrawal: tx.isWithdrawal };
      return { kind: 'confirmed', tx: tx };
    }
    var lower = String(body).toLowerCase();
    if (spamHints.some(function (h) { return lower.indexOf(h) >= 0; })) return { kind: 'not' };

    var hintCount = financialHints.filter(function (h) { return body.indexOf(h) >= 0; }).length;
    bigNumberRx.lastIndex = 0;
    var hasBig = bigNumberRx.test(body);
    if (hintCount >= 2 && hasBig) {
      bigNumberRx.lastIndex = 0;
      var nums = (body.match(bigNumberRx) || [])
        .map(toCleanLong)
        .filter(function (v) { return v !== null && v >= 1000 && v <= 10000000000; });
      var guessed = nums.length ? Math.min.apply(null, nums) : null;
      var guessW = ['برداشت', 'خرید', 'کسر', 'پرداخت'].some(function (k) { return body.indexOf(k) >= 0; }) ||
        !['واریز', 'واريز'].some(function (k) { return body.indexOf(k) >= 0; });
      return { kind: 'ambiguous', guessedAmount: guessed, guessedWithdrawal: guessW };
    }
    return { kind: 'not' };
  }

  var api = { parse: parse, classify: classify, normalize: normalize, isAbnormalAmount: isAbnormalAmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SmsParser = api;
})();
