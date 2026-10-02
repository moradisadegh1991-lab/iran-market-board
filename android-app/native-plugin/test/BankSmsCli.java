package ir.moradisadegh.marketboard;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * Test driver for scripts/bank-sms-java-test.mjs: reads messages separated by NUL from stdin
 * ("body \u0002 address"), prints one canonical record per message, NUL-separated, fields joined
 * by \u0001 — the same record the test builds from the JS parser.
 */
public final class BankSmsCli {
    static String v(Object o) {
        return o == null ? "~" : String.valueOf(o);
    }

    public static void main(String[] args) throws Exception {
        InputStream in = System.in;
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        in.transferTo(buf);
        String all = buf.toString(StandardCharsets.UTF_8);
        PrintStream out = new PrintStream(System.out, false, StandardCharsets.UTF_8);
        StringBuilder sb = new StringBuilder();
        for (String msg : all.split("\u0000", -1)) {
            if (msg.isEmpty()) continue;
            int cut = msg.indexOf('\u0002');
            String body = msg.substring(0, cut), address = msg.substring(cut + 1);
            BankSms.Result c = BankSms.classify(body);
            BankSms.Tx t = BankSms.parse(body);
            BankSms.Row r = BankSms.row(body, address.isEmpty() ? null : address);
            String[] f = {
                c.kind, v(c.guessedAmount), c.kind.equals("ambiguous") ? v(c.guessedWithdrawal) : "~",
                t == null ? "~" : String.join("|", v(t.amount), v(t.isWithdrawal), v(t.cardLast4), v(t.balance), v(t.channel), v(t.accountNo), v(t.isFee), v(t.bankNameInSms), v(t.directionClear)),
                r == null ? "~" : String.join("|", v(r.amountRial), v(r.direction), v(r.card), v(r.accountNo), v(r.bank), v(r.balanceRial), v(r.uncertainAmount)),
            };
            sb.append(String.join("\u0001", f)).append('\u0000');
        }
        out.print(sb);
        out.flush();
    }
}
