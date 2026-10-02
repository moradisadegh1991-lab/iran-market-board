package ir.moradisadegh.marketboard;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.os.Looper;
import android.provider.Telephony;
import androidx.test.core.app.ApplicationProvider;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowPendingIntent;

/**
 * The «نوعش چیست؟» path as Android runs it, on Robolectric (the real framework classes on the JVM):
 * a real SMS_RECEIVED broadcast with GSM PDUs → SmsAskReceiver → the notification on the phone →
 * a button tap → SmsChoiceReceiver → the stored choice the app later reads (SmsReaderPlugin.asked).
 * Run by CI before the APK is built (scripts/wire-native-tests.mjs puts it in the Android project).
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class SmsAskTest {
    private Application app;
    private NotificationManager nm;

    @Before
    public void setUp() {
        app = ApplicationProvider.getApplicationContext();
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS);
        nm = app.getSystemService(NotificationManager.class);
        app.getSharedPreferences(SmsAsk.PREFS, 0).edit().clear().commit();
    }

    // ── a GSM SMS-DELIVER PDU, UCS-2 (how Persian SMS travel), split into parts like the network does ──

    private static byte[] semiOctets(String digits) {
        String d = digits.length() % 2 == 1 ? digits + "F" : digits;
        byte[] out = new byte[d.length() / 2];
        for (int i = 0; i < d.length(); i += 2)
            out[i / 2] = (byte) ((Character.digit(d.charAt(i + 1), 16) << 4) | Character.digit(d.charAt(i), 16));
        return out;
    }

    private static List<byte[]> pdus(String from, String body) {
        byte[] text = body.getBytes(StandardCharsets.UTF_16BE);
        int per = text.length <= 140 ? 140 : 134; // a multipart part carries a 6-byte header
        int parts = (text.length + per - 1) / per;
        List<byte[]> out = new ArrayList<>();
        for (int p = 0; p < parts; p++) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            b.write(0x00); // no SMSC
            b.write(parts > 1 ? 0x44 : 0x04); // SMS-DELIVER (+ user-data header)
            String digits = from.replace("+", "");
            b.write(digits.length());
            b.write(from.startsWith("+") ? 0x91 : 0x81);
            b.writeBytes(semiOctets(digits));
            b.write(0x00); // PID
            b.write(0x08); // UCS-2
            b.writeBytes(new byte[] { 0x62, 0x01, 0x20, (byte) 0x90, 0x41, 0x00, 0x41 }); // 2026-10-02 09:14:00 +03:30
            int from_ = p * per, to = Math.min(text.length, from_ + per);
            if (parts > 1) {
                b.write(6 + to - from_);
                b.writeBytes(new byte[] { 0x05, 0x00, 0x03, 0x2A, (byte) parts, (byte) (p + 1) });
            } else b.write(to - from_);
            b.write(text, from_, to - from_);
            out.add(b.toByteArray());
        }
        return out;
    }

    private void receive(String from, String body) {
        Intent i = new Intent(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        i.putExtra("pdus", pdus(from, body).toArray(new Object[0]));
        i.putExtra("format", "3gpp");
        new SmsAskReceiver().onReceive(app, i);
    }

    private List<Notification> posted() {
        List<Notification> out = new ArrayList<>();
        for (Notification n : shadowOf(nm).getAllNotifications()) out.add(n);
        return out;
    }

    private static String[] actionTitles(Notification n) {
        String[] t = new String[n.actions == null ? 0 : n.actions.length];
        for (int i = 0; i < t.length; i++) t[i] = n.actions[i].title.toString();
        return t;
    }

    private static String title(Notification n) {
        return String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TITLE));
    }

    private static String text(Notification n) {
        return String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TEXT));
    }

    private void tap(Notification n, int action) {
        PendingIntent pi = n.actions[action].actionIntent;
        ShadowPendingIntent s = shadowOf(pi);
        assertTrue("a button sends a broadcast to SmsChoiceReceiver", s.isBroadcastIntent());
        Intent sent = s.getSavedIntent();
        assertEquals(SmsChoiceReceiver.class.getName(), sent.getComponent().getClassName());
        new SmsChoiceReceiver().onReceive(app, sent);
    }

    // ── tests ──

    @Test
    public void withdrawal_asksExpenseOrTransfer_onAHeadsUpChannel_andHidesTheAmountOnTheLockScreen() {
        receive("+98700717", "بانک ملت\nبرداشت: 1,250,000 ریال\nکارت: *4417\nمانده: 12,300,000");
        List<Notification> ns = posted();
        assertEquals(1, ns.size());
        Notification n = ns.get(0);
        assertEquals(SmsAsk.CHANNEL_ID, n.getChannelId());
        NotificationChannel ch = nm.getNotificationChannel(SmsAsk.CHANNEL_ID);
        assertNotNull("the channel exists before the notification (CLAUDE.md rule 14)", ch);
        assertEquals("heads-up", NotificationManager.IMPORTANCE_HIGH, ch.getImportance());
        assertEquals("برداشت ۱۲۵٬۰۰۰ تومان", title(n));
        assertTrue(text(n), text(n).contains("••4417") && text(n).contains("هزینه بود یا انتقال"));
        assertArrayEquals(new String[] { "هزینه", "انتقال به حساب خودم", "باز کردن اپ" }, actionTitles(n));
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility);
        assertNotNull(n.publicVersion);
        assertEquals("پیامک بانکی تازه", title(n.publicVersion));
        assertFalse("no amount on the lock screen", title(n.publicVersion).contains("۱۲۵") || text(n.publicVersion).contains("۱۲۵"));
        int icon = app.getResources().getIdentifier("ic_stat_mali", "drawable", app.getPackageName());
        assertTrue("status-bar icon is in the app", icon != 0);
        assertEquals(icon, n.getSmallIcon().getResId());

        JSONArray items = SmsAsk.items(app);
        assertEquals(1, items.length());
        JSONObject rec = items.optJSONObject(0);
        assertEquals("out", rec.optString("direction"));
        assertEquals(1_250_000L, rec.optLong("amountRial"));
        assertTrue(rec.isNull("choice"));
        assertTrue(rec.optString("body").contains("برداشت: 1,250,000"));
        assertEquals("+98700717", rec.optString("address"));
    }

    @Test
    public void tappingAButton_storesTheChoice_andLeavesAShortQuietConfirmation() {
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417 مانده: 9,000,000");
        final int[] calls = { 0 };
        SmsAsk.onChoice = () -> calls[0]++;
        try {
            tap(posted().get(0), 0);
        } finally {
            SmsAsk.onChoice = null;
        }
        JSONObject rec = SmsAsk.items(app).optJSONObject(0);
        assertEquals("expense", rec.optString("choice"));
        assertTrue(rec.optLong("chosenAt") > 0);
        assertEquals("the open app is told at once", 1, calls[0]);
        List<Notification> ns = posted();
        assertEquals("the same notification, replaced", 1, ns.size());
        Notification n = ns.get(0);
        assertEquals("✓ هزینه · ۱۲۵٬۰۰۰ تومان", title(n));
        assertEquals(0, n.actions == null ? 0 : n.actions.length);
        assertEquals(8_000, n.getTimeoutAfter());
    }

    @Test
    public void noDirectionInTheSms_theUserSaysWhichWayTheMoneyWent() {
        receive("Bank Melli", "تراکنش کارت شما در بانک ملت به مبلغ 2,400,000 ریال ثبت شد");
        Notification n = posted().get(0);
        assertEquals("تراکنش ۲۴۰٬۰۰۰ تومان", title(n));
        assertArrayEquals(new String[] { "هزینه", "درآمد", "باز کردن اپ" }, actionTitles(n));
        assertTrue(SmsAsk.items(app).optJSONObject(0).isNull("direction"));
        tap(n, 1);
        assertEquals("income", SmsAsk.items(app).optJSONObject(0).optString("choice"));
    }

    @Test
    public void deposit_offersIncomeOrTransferIn_andAChoiceAgainstTheBankIsRefused() {
        receive("+98700717", "واریز 3,000,000 ریال به حساب شما کارت: *4417 مانده: 14,600,000");
        Notification n = posted().get(0);
        assertEquals("واریز ۳۰۰٬۰۰۰ تومان", title(n));
        assertArrayEquals(new String[] { "درآمد", "انتقال از حساب خودم", "باز کردن اپ" }, actionTitles(n));
        String key = SmsAsk.items(app).optJSONObject(0).optString("key");
        assertFalse("a deposit cannot be booked as an expense", SmsAsk.setChoice(app, key, "expense", 1));
        assertTrue(SmsAsk.setChoice(app, key, "transfer-in", 1));
    }

    @Test
    public void aLongSmsInSeveralParts_isOneMessage() {
        String body = "بانک ملت\nمشتری گرامی، برداشت از حساب شما به‌صورت خرید کارتی انجام شد.\nمبلغ: 1,250,000 ریال\nکارت: *4417\nمانده: 12,300,000\nزمان: 1405/07/10 12:30\nبا تشکر از انتخاب شما";
        assertTrue("needs more than one part", body.length() > 70);
        receive("+98700717", body);
        assertEquals(1, posted().size());
        JSONObject rec = SmsAsk.items(app).optJSONObject(0);
        assertEquals(body, rec.optString("body"));
        assertEquals(1_250_000L, rec.optLong("amountRial"));
    }

    @Test
    public void theManifestRoutesTheSystemBroadcastAndTheButton_throughAndroidItself() throws Exception {
        // the receiver is found for SMS_RECEIVED, and only the system may send it
        List<ResolveInfo> rs = app.getPackageManager().queryBroadcastReceivers(new Intent(Telephony.Sms.Intents.SMS_RECEIVED_ACTION), 0);
        ResolveInfo mine = null;
        for (ResolveInfo r : rs) if (r.activityInfo.name.endsWith(".SmsAskReceiver")) mine = r;
        assertNotNull("SmsAskReceiver is declared for SMS_RECEIVED", mine);
        assertEquals(Manifest.permission.BROADCAST_SMS, mine.activityInfo.permission);
        // delivered by the framework, not called by hand
        Intent i = new Intent(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        i.putExtra("pdus", pdus("+98700717", "برداشت: 1,250,000 ریال کارت: *4417").toArray(new Object[0]));
        i.putExtra("format", "3gpp");
        app.sendBroadcast(i);
        shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, posted().size());
        // the button's own PendingIntent, sent as the notification would
        posted().get(0).actions[1].actionIntent.send();
        shadowOf(Looper.getMainLooper()).idle();
        assertEquals("transfer-out", SmsAsk.items(app).optJSONObject(0).optString("choice"));
        assertEquals("✓ انتقال به حساب خودم · ۱۲۵٬۰۰۰ تومان", title(posted().get(0)));
    }

    @Test
    public void codesPersonalMessagesAndOperators_areLeftAlone() {
        receive("+98700717", "رمز پویا: 84213\nمبلغ 1,500,000 ریال\nمقصد: فروشگاه");
        receive("+989121234567", "سلام، شام میای؟");
        receive("Irancell", "ایرانسل: شارژ شما 200,000 ریال افزایش یافت");
        assertEquals(0, posted().size());
        assertEquals(0, SmsAsk.items(app).length());
    }

    @Test
    public void switchedOff_inTheApp_nothingIsAsked() {
        SmsAsk.setOn(app, false);
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417");
        assertEquals(0, posted().size());
        assertEquals(0, SmsAsk.items(app).length());
    }

    @Test
    public void notificationsNotAllowed_theSmsIsStillRecordedForTheApp() {
        shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS);
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417");
        assertEquals(0, posted().size());
        assertEquals(1, SmsAsk.items(app).length());
    }

    @Test
    public void theSameSmsDeliveredTwice_isAskedOnce() {
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417 مانده: 9,000,000");
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417 مانده: 9,000,000");
        assertEquals(1, SmsAsk.items(app).length());
        assertEquals(1, posted().size());
    }

    @Test
    public void clearedByTheApp_anUnansweredQuestionDisappears() {
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417");
        String key = SmsAsk.items(app).optJSONObject(0).optString("key");
        assertEquals(1, SmsAsk.remove(app, Collections.singleton(key)));
        assertEquals(0, posted().size());
        assertEquals(0, SmsAsk.items(app).length());
        // a late tap on a question that is gone does nothing but clear it
        Intent late = new Intent(app, SmsChoiceReceiver.class).putExtra(SmsAsk.EXTRA_KEY, key).putExtra(SmsAsk.EXTRA_CHOICE, "expense");
        new SmsChoiceReceiver().onReceive(app, late);
        assertEquals(0, SmsAsk.items(app).length());
    }

    @Test
    public void tappingTheNotification_opensTheImportPage() {
        receive("+98700717", "برداشت: 1,250,000 ریال کارت: *4417");
        Notification n = posted().get(0);
        ShadowPendingIntent s = shadowOf(n.contentIntent);
        assertTrue(s.isActivityIntent());
        assertEquals("/import", s.getSavedIntent().getStringExtra(SmsAsk.EXTRA_ROUTE));
        assertEquals(app.getPackageName(), s.getSavedIntent().getPackage());
        ShadowPendingIntent open = shadowOf(n.actions[2].actionIntent);
        assertTrue(open.isActivityIntent());
        assertEquals("/import", open.getSavedIntent().getStringExtra(SmsAsk.EXTRA_ROUTE));
    }

    @Test
    public void tomanRounding_andAnUncertainAmountSaysSo() {
        assertEquals("۱٬۲۳۴٬۵۶۸ تومان", SmsAsk.toman(12_345_678));
        assertEquals("۰ تومان", SmsAsk.toman(4));
        BankSms.Row r = BankSms.row("حساب شما 5,000,000 ریال مانده 9,000,000 بانک", "");
        assertNotNull(r);
        assertTrue(r.uncertainAmount);
        assertNull(r.direction);
        assertTrue(SmsAsk.title(r), SmsAsk.title(r).startsWith("تراکنش حدود "));
    }
}
