package ir.moradisadegh.marketboard;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The bank-SMS classifier of www/sms-parser.js, line for line, so the phone can decide on its own
 * — with the app closed — whether an arriving SMS is a bank transaction worth asking about, and
 * which way the money went.
 *
 * It decides only that. The row the book receives is still built by the JavaScript parser when
 * the app opens (lib/finance/importers.ts); what the user picked in the notification is applied
 * to that row. scripts/bank-sms-java-test.mjs runs this class and the JS parser over the same
 * messages (the parser's own test corpus plus thousands of generated ones) and fails on any
 * difference — keep the two in step when either changes.
 *
 * Porting notes (JS → java.util.regex):
 *  • JS `\s` is Unicode whitespace; Java's is ASCII only, so `S` below spells out the JS set.
 *  • JS `$` without the m flag matches only at the very end; Java's also before a final line
 *    break, so `\z` is used there.
 *  • JS `trim()` strips the same Unicode set; Java's trim() does not (jsTrim).
 * Pure Java, no Android imports: it is tested with plain javac.
 */
public final class BankSms {
    private BankSms() {}

    /** JS `\s` */
    private static final String S = "[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]";
    private static final String D = "[0-9]";

    private static final String[] WITHDRAW_KEYS = { "برداشت", "خرید", "انتقال از", "کسر", "پرداخت", "انتقال وجه", "حساب شما پرید" };
    private static final String[] AMOUNT_BEFORE_KEYS = { "حساب شما پرید" };
    private static final String[] DEPOSIT_KEYS = { "واریز", "واريز", "انتقال به حساب شما", "افزایش" };

    private static final Pattern RESALAT = Pattern.compile("^([+\\-])([0-9,،]+)" + S + "*$|^([0-9,،]+)" + S + "*([+\\-])" + S + "*$", Pattern.MULTILINE);
    private static final Pattern MABLAGH = Pattern.compile("مبلغ" + S + "*([0-9,،]+)" + S + "*ریال");
    private static final Pattern KW_AMOUNT = Pattern.compile("([0-9,،]{4,})");
    private static final Pattern BALANCE = Pattern.compile("(?:مانده|موجودی)" + S + "*:?" + S + "*([0-9,،]+)");
    private static final Pattern CARD = Pattern.compile(D + "{4,6}[*.x]{2,}(" + D + "{4})|کارت" + S + "*:?" + S + "*\\*?(" + D + "{4})");
    private static final Pattern ACCOUNT = Pattern.compile("حساب" + S + "*:?" + S + "*(" + D + "{6,})");
    // JS `.` = anything but \n \r
    private static final Pattern CHANNEL = Pattern.compile("(?:از" + S + "*طریق|از" + S + "*طريق|کانال)" + S + "*:?" + S + "*([^\\n\\r\\u2028\\u2029]{2,40})");
    private static final Pattern BANK_NAME = Pattern.compile("عنوان" + S + "*بانک" + S + "+([A-Za-z\\u0600-\\u06FF]{2,30})");
    private static final Pattern RESALAT_REF = Pattern.compile("^" + D + "+\\." + D + "+\\." + D + "+");
    private static final Pattern NUM4 = Pattern.compile("[0-9,،]{4,}");
    private static final Pattern BIG_NUMBER = Pattern.compile("[0-9,،]{5,}");
    private static final Pattern BARE_CODE = Pattern.compile("(?:^|" + S + ")(?:کد|رمز)" + S + "*:?" + S + "*" + D + "{4,8}(?:" + S + "|\\z)");
    private static final Pattern SEPAH = Pattern.compile("سپه");

    private static final String[] FINANCIAL_HINTS = { "ریال", "ريال", "تومان", "مانده", "موجودی", "حساب", "کارت",
        "برداشت", "واریز", "واريز", "خرید", "انتقال", "تراکنش", "بانک" };
    private static final String[] SPAM_HINTS = { "رمز یکبار", "رمز پویا", "رمز دوم", "کد تایید", "کد تأیید", "کد فعالسازی", "کد فعال‌سازی",
        "otp", "تخفیف", "جشنواره", "اقساط وام", "کد ورود", "لغو11", "لغو 11" };
    private static final String[] OPERATOR_HINTS = { "ایرانسل", "همراه اول", "همراه‌اول", "رایتل", "شاتل", "مخابرات", "مخابرات ایران",
        "اپراتور", "شارژ شما", "بسته اینترنت", "بسته اینترنتی", "اعتبار شما", "باقیمانده بسته",
        "رمز شبکه", "کد شگفت", "سیم کارت", "سیم‌کارت", "mci", "irancell", "rightel", "shatel" };
    private static final String[] FEE_HINTS = { "کارمزد", "کارمزد انتقال", "هزینه انتقال", "کارمزد تراکنش", "کارمزد خدمات" };

    /** What sms-parser.js parse() returns. */
    public static final class Tx {
        public long amount;
        public boolean isWithdrawal;
        public String cardLast4;
        public Long balance;
        public String channel;
        public String accountNo;
        public boolean isFee;
        public String bankNameInSms;
        public boolean directionClear;
    }

    /** What sms-parser.js classify() returns: kind is "not", "ambiguous" or "confirmed". */
    public static final class Result {
        public String kind;
        public Tx tx;
        public Long guessedAmount;
        public boolean guessedWithdrawal;

        static Result not() {
            Result r = new Result();
            r.kind = "not";
            return r;
        }
    }

    /** The row rowsFromMessages() (lib/finance/importers.ts) would queue, reduced to what the notification needs. */
    public static final class Row {
        public long amountRial;
        /** "out", "in", or null when the SMS does not say — then the user is asked for it */
        public String direction;
        public String card;
        public String accountNo;
        public String bank;
        public Long balanceRial;
        public boolean uncertainAmount;
    }

    // ── helpers with JS semantics ──

    static boolean isJsSpace(char c) {
        return c == '\t' || c == '\n' || c == 0x0B || c == '\f' || c == '\r' || c == ' ' || c == 0xA0 || c == 0x1680
            || (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
    }

    static String jsTrim(String s) {
        int a = 0, b = s.length();
        while (a < b && isJsSpace(s.charAt(a))) a++;
        while (b > a && isJsSpace(s.charAt(b - 1))) b--;
        return s.substring(a, b);
    }

    /** Persian/Arabic digits → ASCII, unify ي/ك, drop bidi control marks. */
    public static String normalize(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= '۰' && c <= '۹') out.append((char) ('0' + (c - 0x06F0)));
            else if (c >= '٠' && c <= '٩') out.append((char) ('0' + (c - 0x0660)));
            else if (c == 'ي') out.append('ی');
            else if (c == 'ك') out.append('ک');
            else if (c >= 0x200E && c <= 0x200F) continue;
            else if (c >= 0x202A && c <= 0x202E) continue;
            else if (c >= 0x2066 && c <= 0x2069) continue;
            else out.append(c);
        }
        return out.toString();
    }

    static Long toCleanLong(String s) {
        if (s == null) return null;
        String v = jsTrim(s.replace(",", "").replace("،", ""));
        if (v.isEmpty()) return null;
        for (int i = 0; i < v.length(); i++) if (v.charAt(i) < '0' || v.charAt(i) > '9') return null;
        // beyond 18 digits JS still yields a (huge) number; this saturates the same way for every check made with it
        if (v.length() > 18) return Long.MAX_VALUE;
        return Long.parseLong(v);
    }

    static String firstGroup(Pattern rx, String s, int idx) {
        Matcher m = rx.matcher(s);
        if (!m.find()) return null;
        String g = m.group(idx);
        return g == null || g.isEmpty() ? null : g;
    }

    static boolean containsAny(String s, String[] keys) {
        for (String k : keys) if (s.contains(k)) return true;
        return false;
    }

    static boolean isFeeText(String n) {
        return containsAny(n, FEE_HINTS);
    }

    static boolean hasBankVerb(String n) {
        return containsAny(n, WITHDRAW_KEYS) || containsAny(n, DEPOSIT_KEYS);
    }

    // ── parse ──

    static Tx parseResalat(String n) {
        Matcher m = RESALAT.matcher(n);
        if (!m.find()) return null;
        String sign = m.group(1) != null ? m.group(1) : (m.group(4) != null ? m.group(4) : "");
        String numStr = m.group(2) != null && !m.group(2).isEmpty() ? m.group(2) : (m.group(3) != null ? m.group(3) : "");
        Long amount = toCleanLong(numStr);
        if (amount == null || amount < 1000) return null;
        Matcher ref = RESALAT_REF.matcher(jsTrim(n));
        String ref4 = null;
        if (ref.find()) {
            String digits = ref.group().replace(".", "");
            ref4 = digits.length() > 4 ? digits.substring(digits.length() - 4) : digits;
        }
        Tx t = new Tx();
        t.amount = amount;
        t.isWithdrawal = sign.equals("-");
        t.cardLast4 = ref4;
        t.balance = toCleanLong(firstGroup(BALANCE, n, 1));
        t.channel = null;
        t.accountNo = firstGroup(ACCOUNT, n, 1);
        t.isFee = isFeeText(n);
        String bn = firstGroup(BANK_NAME, n, 1);
        bn = bn == null ? "" : jsTrim(bn);
        t.bankNameInSms = bn.isEmpty() ? null : bn;
        t.directionClear = true;
        return t;
    }

    static Tx parseSepah(String n) {
        Long amount = toCleanLong(firstGroup(MABLAGH, n, 1));
        if (amount == null || amount < 1000) return null;
        boolean isWithdrawal = containsAny(n, WITHDRAW_KEYS);
        boolean isDeposit = containsAny(n, DEPOSIT_KEYS);
        boolean isSepah = SEPAH.matcher(n).find();
        String named = firstGroup(BANK_NAME, n, 1);
        named = named == null ? "" : jsTrim(named);
        Tx t = new Tx();
        t.amount = amount;
        t.isWithdrawal = isWithdrawal;
        t.cardLast4 = null;
        t.balance = toCleanLong(firstGroup(BALANCE, n, 1));
        t.channel = isSepah ? "اینترنت‌بانک سپه" : null;
        t.accountNo = firstGroup(ACCOUNT, n, 1);
        t.isFee = isFeeText(n);
        t.bankNameInSms = isSepah ? "بانک سپه" : (named.isEmpty() ? null : named);
        t.directionClear = isWithdrawal != isDeposit;
        return t;
    }

    static Tx parseKeyword(String n) {
        boolean isWithdrawal = containsAny(n, WITHDRAW_KEYS);
        boolean isDeposit = containsAny(n, DEPOSIT_KEYS);
        if (!isWithdrawal && !isDeposit) return null;

        String keyword = null;
        for (String k : WITHDRAW_KEYS) if (n.contains(k)) { keyword = k; break; }
        if (keyword == null) for (String k : DEPOSIT_KEYS) if (n.contains(k)) { keyword = k; break; }
        if (keyword == null) return null;

        Long amount;
        boolean before = false;
        for (String k : AMOUNT_BEFORE_KEYS) if (k.equals(keyword)) before = true;
        int at = n.indexOf(keyword);
        if (before) {
            Matcher m = NUM4.matcher(n.substring(0, at));
            String last = null;
            while (m.find()) last = m.group();
            amount = last != null ? toCleanLong(last) : null;
        } else {
            amount = toCleanLong(firstGroup(KW_AMOUNT, n.substring(at + keyword.length()), 1));
        }
        if (amount == null || amount < 1000) return null;

        Matcher cm = CARD.matcher(n);
        String card = null;
        if (cm.find()) {
            String g1 = cm.group(1), g2 = cm.group(2);
            card = g1 != null && !g1.isEmpty() ? g1 : (g2 != null && !g2.isEmpty() ? g2 : null);
        }
        String chan = firstGroup(CHANNEL, n, 1);
        Tx t = new Tx();
        t.amount = amount;
        t.isWithdrawal = isWithdrawal && !isDeposit;
        t.cardLast4 = card;
        t.balance = toCleanLong(firstGroup(BALANCE, n, 1));
        if (chan != null) {
            String c = jsTrim(chan);
            t.channel = c.length() > 40 ? c.substring(0, 40) : c;
        }
        t.accountNo = firstGroup(ACCOUNT, n, 1);
        t.isFee = isFeeText(n);
        t.bankNameInSms = null;
        t.directionClear = !(isWithdrawal && isDeposit);
        return t;
    }

    public static Tx parse(String body) {
        String n = normalize(body);
        if (RESALAT.matcher(n).find()) return parseResalat(n);
        if (MABLAGH.matcher(n).find()) return parseSepah(n);
        return parseKeyword(n);
    }

    // ── classify ──

    static boolean isOperatorMessage(String body) {
        String n = normalize(body);
        String lower = n.toLowerCase(Locale.ROOT);
        boolean fromOperator = containsAny(lower, OPERATOR_HINTS);
        boolean bareCode = BARE_CODE.matcher(n).find();
        if (!hasBankVerb(n) && bareCode) return true;
        if (!fromOperator) return false;
        if (bareCode) return true;
        boolean hasAccountEvidence = CARD.matcher(n).find() || ACCOUNT.matcher(n).find();
        return !hasAccountEvidence;
    }

    static boolean isAbnormalAmount(long amount) {
        String s = Long.toString(amount);
        return (s.length() == 12 && s.startsWith("989")) || amount > 20_000_000_000L;
    }

    public static Result classify(String body) {
        String lower0 = body.toLowerCase(Locale.ROOT);
        if (containsAny(lower0, SPAM_HINTS)) return Result.not();
        if (isOperatorMessage(body)) return Result.not();

        Tx tx = parse(body);
        if (tx != null) {
            Result r = new Result();
            if (isAbnormalAmount(tx.amount)) {
                r.kind = "ambiguous";
                r.guessedAmount = tx.amount;
                r.guessedWithdrawal = tx.isWithdrawal;
            } else {
                r.kind = "confirmed";
                r.tx = tx;
            }
            return r;
        }

        int hintCount = 0;
        for (String h : FINANCIAL_HINTS) if (body.contains(h)) hintCount++;
        Matcher big = BIG_NUMBER.matcher(body);
        if (hintCount >= 2 && big.find()) {
            big.reset();
            List<Long> nums = new ArrayList<>();
            while (big.find()) {
                Long v = toCleanLong(big.group());
                if (v != null && v >= 1000 && v <= 10_000_000_000L) nums.add(v);
            }
            Result r = new Result();
            r.kind = "ambiguous";
            Long min = null;
            for (Long v : nums) if (min == null || v < min) min = v;
            r.guessedAmount = min;
            r.guessedWithdrawal = body.contains("برداشت") || body.contains("خرید") || body.contains("کسر") || body.contains("پرداخت")
                || !(body.contains("واریز") || body.contains("واريز"));
            return r;
        }
        return Result.not();
    }

    /**
     * rowsFromMessages() for one message: null when the app would not queue it (not a bank
     * transaction, or no amount found). `address` is the sender, used as the bank when the text names none.
     */
    public static Row row(String rawBody, String address) {
        if (rawBody == null) return null;
        String body = jsTrim(rawBody);
        if (body.length() <= 8) return null;
        Result c = classify(body);
        long k = body.contains("تومان") && !(body.contains("ریال") || body.contains("ريال")) ? 10 : 1;
        String sender = address == null ? "" : jsTrim(address);
        Row r = new Row();
        r.bank = sender.isEmpty() ? null : sender;
        if (c.kind.equals("not")) return null;
        if (c.kind.equals("ambiguous")) {
            if (c.guessedAmount == null || c.guessedAmount == 0) return null;
            r.amountRial = c.guessedAmount * k;
            r.direction = null;
            r.uncertainAmount = true;
            return r;
        }
        Tx t = c.tx;
        r.amountRial = t.amount * k;
        r.direction = t.directionClear ? (t.isWithdrawal ? "out" : "in") : null;
        r.card = t.cardLast4;
        r.accountNo = t.accountNo;
        r.balanceRial = t.balance == null ? null : t.balance * k;
        if (t.bankNameInSms != null && !t.bankNameInSms.isEmpty()) r.bank = t.bankNameInSms;
        return r;
    }
}
