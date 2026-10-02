package ir.moradisadegh.marketboard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/**
 * A button on the «نوعش چیست؟» notification was tapped: the choice is stored on the phone and the
 * notification turns into a short «✓ هزینه» confirmation. The app books it when it next runs —
 * at once if it is open (SmsAsk.onChoice). Not exported: only this app's own notification can call it.
 */
public class SmsChoiceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        String key = intent.getStringExtra(SmsAsk.EXTRA_KEY);
        String choice = intent.getStringExtra(SmsAsk.EXTRA_CHOICE);
        if (key == null || choice == null) return;
        if (!SmsAsk.setChoice(ctx, key, choice, System.currentTimeMillis())) {
            // the record is gone (already booked in the app) — just clear the question
            androidx.core.app.NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra(SmsAsk.EXTRA_NOTIF, SmsAsk.notifId(key)));
            return;
        }
        JSONObject rec = SmsAsk.find(ctx, key);
        if (rec != null) SmsAsk.confirm(ctx, rec, choice);
        Runnable r = SmsAsk.onChoice;
        if (r != null) r.run();
    }
}
