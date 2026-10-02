package ir.moradisadegh.marketboard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * Android delivers every arriving SMS here — also while the app is closed (it runs for the length
 * of this call, no service is kept alive). A bank transaction gets the «نوعش چیست؟» notification
 * (SmsAsk); anything else is left alone. Declared in the manifest with
 * android:permission="android.permission.BROADCAST_SMS", so only the system can call it, and it
 * needs RECEIVE_SMS, which the app asks for together with READ_SMS.
 *
 * It only reads the message. It does not stop the broadcast, so the phone's own SMS app shows the
 * message as always.
 */
public class SmsAskReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!SmsAsk.isOn(ctx)) return;
        SmsMessage[] parts;
        try {
            parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        } catch (RuntimeException e) {
            return;
        }
        if (parts == null) return;
        // a long SMS arrives in parts; one sender's parts are one message
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        for (SmsMessage p : parts) {
            if (p == null) continue;
            String from = p.getDisplayOriginatingAddress();
            String key = from == null ? "" : from;
            StringBuilder sb = bySender.get(key);
            if (sb == null) bySender.put(key, sb = new StringBuilder());
            String body = p.getDisplayMessageBody();
            if (body != null) sb.append(body);
        }
        long now = System.currentTimeMillis();
        for (Map.Entry<String, StringBuilder> e : bySender.entrySet()) {
            String body = e.getValue().toString();
            BankSms.Row row = BankSms.row(body, e.getKey());
            if (row == null) continue; // not a bank transaction: no question
            JSONObject rec = SmsAsk.add(ctx, e.getKey(), body, now, row);
            if (rec != null) SmsAsk.notifyAsk(ctx, rec, row);
        }
    }
}
