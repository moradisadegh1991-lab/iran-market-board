package ir.moradisadegh.marketboard;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * «نوعش چیست؟» — the notification that appears the moment a bank SMS arrives, app open or closed.
 *
 * SmsAskReceiver gets the SMS from Android, BankSms decides whether it is a bank transaction, and
 * this posts a heads-up notification with the choices that agree with what the bank said
 * (a withdrawal can be «هزینه» or «انتقال به حساب خودم», never «درآمد»; with no verb in the SMS the
 * user says which way the money went — CLAUDE.md rule 3). The tap is recorded here, on the phone;
 * the book lives in the WebView's storage, so the app applies it the next time it runs
 * (lib/finance/sms-ask.ts) and then clears the record.
 *
 * Nothing here leaves the phone. On the lock screen only «پیامک بانکی تازه» shows — the amount and
 * the card appear once the phone is unlocked (a public version of the notification).
 */
public final class SmsAsk {
    private SmsAsk() {}

    public static final String CHANNEL_ID = "imb-sms-ask";
    static final String PREFS = "imf_sms_ask";
    static final String KEY_ITEMS = "items";
    static final String KEY_ON = "on";
    public static final String EXTRA_ROUTE = "imf.route";
    static final String EXTRA_KEY = "imf.key";
    static final String EXTRA_CHOICE = "imf.choice";
    static final String EXTRA_NOTIF = "imf.notif";
    static final long KEEP_MS = 14L * 86_400_000L;
    static final int MAX_ITEMS = 300;

    /** Called when a choice is made while the app runs, so it is applied at once. Set by SmsReaderPlugin. */
    static volatile Runnable onChoice;

    public static final String[] CHOICES = { "expense", "income", "transfer-out", "transfer-in" };

    static String label(String choice) {
        switch (choice) {
            case "expense": return "هزینه";
            case "income": return "درآمد";
            case "transfer-out": return "انتقال به حساب خودم";
            case "transfer-in": return "انتقال از حساب خودم";
            default: return choice;
        }
    }

    /** The two choices that agree with the direction the bank stated (or the plain two when it stated none). */
    static String[] choicesFor(String direction) {
        if ("out".equals(direction)) return new String[] { "expense", "transfer-out" };
        if ("in".equals(direction)) return new String[] { "income", "transfer-in" };
        return new String[] { "expense", "income" };
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean isOn(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ON, true);
    }

    public static void setOn(Context ctx, boolean on) {
        prefs(ctx).edit().putBoolean(KEY_ON, on).apply();
    }

    // ── the records ──

    public static synchronized JSONArray items(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_ITEMS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static void save(Context ctx, JSONArray a) {
        prefs(ctx).edit().putString(KEY_ITEMS, a.toString()).commit();
    }

    static int notifId(String key) {
        return 0x5A000000 | (key.hashCode() & 0x00FFFFFF);
    }

    /** Stores an arrived bank SMS; returns the record, or null if this very message is already stored. */
    public static synchronized JSONObject add(Context ctx, String address, String body, long at, BankSms.Row row) {
        String key = Long.toString(at, 36) + "-" + Integer.toHexString((address + "\n" + body).hashCode());
        JSONArray old = items(ctx);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o == null || at - o.optLong("at") > KEEP_MS) continue;
            // the same SMS delivered twice (some phones re-broadcast after a reboot)
            if (o.optString("body").equals(body) && o.optString("address").equals(address) && Math.abs(at - o.optLong("at")) < 120_000) return null;
            keep.put(o);
        }
        JSONObject rec = new JSONObject();
        try {
            rec.put("key", key);
            rec.put("address", address == null ? "" : address);
            rec.put("body", body);
            rec.put("at", at);
            rec.put("amountRial", row.amountRial);
            rec.put("direction", row.direction == null ? JSONObject.NULL : row.direction);
            rec.put("choice", JSONObject.NULL);
        } catch (JSONException e) {
            return null;
        }
        keep.put(rec);
        while (keep.length() > MAX_ITEMS) keep.remove(0);
        save(ctx, keep);
        return rec;
    }

    /** Records the user's tap. False when the record is gone or the choice contradicts the bank. */
    public static synchronized boolean setChoice(Context ctx, String key, String choice, long now) {
        JSONArray a = items(ctx);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || !key.equals(o.optString("key"))) continue;
            String dir = o.isNull("direction") ? null : o.optString("direction");
            boolean ok = false;
            for (String c : choicesFor(dir)) ok |= c.equals(choice);
            if (!ok) return false;
            try {
                o.put("choice", choice);
                o.put("chosenAt", now);
            } catch (JSONException e) {
                return false;
            }
            save(ctx, a);
            return true;
        }
        return false;
    }

    public static synchronized JSONObject find(Context ctx, String key) {
        JSONArray a = items(ctx);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && key.equals(o.optString("key"))) return o;
        }
        return null;
    }

    /** Drops records the app has applied, and takes their notifications off the screen. */
    public static synchronized int remove(Context ctx, java.util.Set<String> keys) {
        JSONArray a = items(ctx);
        JSONArray keep = new JSONArray();
        int n = 0;
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            String k = o.optString("key");
            if (keys.contains(k)) {
                n++;
                // still asking (booked in the app first): the question is moot now
                if (o.isNull("choice")) nm.cancel(notifId(k));
            } else keep.put(o);
        }
        save(ctx, keep);
        return n;
    }

    // ── the notification ──

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "نوع تراکنش پیامک‌های بانکی", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("وقتی پیامک بانکی می‌رسد، همان لحظه می‌پرسد هزینه بود، درآمد یا انتقال.");
        ch.enableVibration(true);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    static int smallIcon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_mali", "drawable", ctx.getPackageName());
        return id != 0 ? id : ctx.getApplicationInfo().icon;
    }

    static boolean canPost(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33
            && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    static int immutable() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    /** Opens the app on a page (CLAUDE.md rule 35: the web layer navigates with its own router). */
    static PendingIntent openApp(Context ctx, String route, int requestCode) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent();
        i.setPackage(ctx.getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_ROUTE, route);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    }

    /** 12345678 rial → «۱٬۲۳۴٬۵۶۸ تومان» (rounded to whole toman), without depending on the phone's locale data. */
    static String toman(long rial) {
        String s = Long.toString(Math.round(rial / 10.0));
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            if (i > 0 && (s.length() - i) % 3 == 0) out.append('٬');
            char c = s.charAt(i);
            out.append(c >= '0' && c <= '9' ? (char) ('۰' + (c - '0')) : c);
        }
        return out.append(" تومان").toString();
    }

    static String title(BankSms.Row row) {
        String what = "out".equals(row.direction) ? "برداشت" : "in".equals(row.direction) ? "واریز" : "تراکنش";
        return what + " " + (row.uncertainAmount ? "حدود " : "") + toman(row.amountRial);
    }

    static String where(BankSms.Row row) {
        StringBuilder s = new StringBuilder();
        // isolated left-to-right, or «••4417» shows as «4417••» inside Persian text
        if (row.card != null) s.append("کارت ⁦••").append(row.card).append("⁩");
        else if (row.accountNo != null) {
            String a = row.accountNo.length() > 6 ? "…" + row.accountNo.substring(row.accountNo.length() - 6) : row.accountNo;
            s.append("حساب ⁦").append(a).append("⁩");
        }
        if (row.bank != null && !row.bank.matches("\\+?[0-9]+")) s.append(s.length() > 0 ? " · " : "").append(row.bank);
        return s.toString();
    }

    @SuppressLint("MissingPermission") // canPost() checks it
    public static boolean notifyAsk(Context ctx, JSONObject rec, BankSms.Row row) {
        if (!canPost(ctx)) return false;
        ensureChannel(ctx);
        String key = rec.optString("key");
        int id = notifId(key);
        String place = where(row);
        String question = "out".equals(row.direction) ? "هزینه بود یا انتقال به حساب خودتان؟"
            : "in".equals(row.direction) ? "درآمد بود یا انتقال از حساب خودتان؟"
            : "پیامک نگفته پول رفت یا آمد — شما بگویید:";
        String text = (place.isEmpty() ? "" : place + " — ") + question;

        NotificationCompat.Builder pub = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(smallIcon(ctx))
            .setColor(Color.rgb(0xD9, 0xA0, 0x2A))
            .setContentTitle("پیامک بانکی تازه")
            .setContentText("نوع تراکنش را انتخاب کنید");

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(smallIcon(ctx))
            .setColor(Color.rgb(0xD9, 0xA0, 0x2A))
            .setContentTitle(title(row))
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub.build())
            .setWhen(rec.optLong("at"))
            .setShowWhen(true)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, "/import", id));

        int n = 0;
        for (String choice : choicesFor(row.direction)) {
            Intent i = new Intent(ctx, SmsChoiceReceiver.class);
            i.putExtra(EXTRA_KEY, key);
            i.putExtra(EXTRA_CHOICE, choice);
            i.putExtra(EXTRA_NOTIF, id);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, id * 4 + n++, i, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
            b.addAction(0, label(choice), pi);
        }
        // anything else — a transfer when the SMS gave no direction, not mine, check the amount — in the app
        b.addAction(0, "باز کردن اپ", openApp(ctx, "/import", id * 4 + 3));
        NotificationManagerCompat.from(ctx).notify(id, b.build());
        return true;
    }

    /** After a tap: the same notification, quiet, saying what was recorded; it goes away by itself. */
    @SuppressLint("MissingPermission")
    public static void confirm(Context ctx, JSONObject rec, String choice) {
        int id = notifId(rec.optString("key"));
        if (!canPost(ctx)) return;
        ensureChannel(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(smallIcon(ctx))
            .setColor(Color.rgb(0xD9, 0xA0, 0x2A))
            .setContentTitle("✓ " + label(choice) + " · " + toman(rec.optLong("amountRial")))
            .setContentText("با باز شدن اپ در دفتر اعمال می‌شود.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(8_000)
            .setContentIntent(openApp(ctx, "/transactions", id));
        NotificationManagerCompat.from(ctx).notify(id, b.build());
    }
}
