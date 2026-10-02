package ir.moradisadegh.marketboard;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

/**
 * Reads the SMS inbox so the web layer can parse bank messages, and hands the web layer what the
 * user picked in the «نوعش چیست؟» notifications (SmsAsk, SmsAskReceiver, SmsChoiceReceiver).
 *
 * The inbox read returns raw message bodies; parsing, classification and storage happen in
 * JavaScript (sms-parser.js, covered by scripts/sms-parser-test.mjs). The notification side
 * needs a decision with the app closed, so BankSms.java carries the same classifier — kept
 * identical by scripts/native-sms-test.ts.
 *
 * It only ever READS SMS. There is no send, no delete, and no network call here: the bodies
 * never leave the device.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        // RECEIVE_SMS: the notification the moment a bank SMS arrives (same permission group, so
        // a phone that already allowed reading SMS grants it without a second dialog)
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS })
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final Uri INBOX = Uri.parse("content://sms/inbox");

    @Override
    public void load() {
        SmsAsk.ensureChannel(getContext());
        // a notification button tapped while the app runs: tell the web layer to apply it now
        SmsAsk.onChoice = () -> notifyListeners("smsChoice", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        SmsAsk.onChoice = null;
    }

    /** A notification opened the app while it was running: the web layer goes to that page. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        String route = takeRoute(intent);
        if (route != null) {
            JSObject ret = new JSObject();
            ret.put("route", route);
            notifyListeners("route", ret, true);
        }
    }

    private static String takeRoute(Intent intent) {
        if (intent == null) return null;
        String route = intent.getStringExtra(SmsAsk.EXTRA_ROUTE);
        if (route == null || !route.startsWith("/")) return null;
        intent.removeExtra(SmsAsk.EXTRA_ROUTE);
        return route;
    }

    private JSObject permissions() {
        JSObject ret = new JSObject();
        ret.put("granted", hasSms());
        ret.put("receive", has(Manifest.permission.RECEIVE_SMS));
        return ret;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        call.resolve(permissions());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasSms() && has(Manifest.permission.RECEIVE_SMS)) {
            call.resolve(permissions());
            return;
        }
        requestPermissionForAlias("sms", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(permissions());
    }

    private boolean has(String permission) {
        return getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasSms() {
        return has(Manifest.permission.READ_SMS);
    }

    /** asked() -> { on, items: [{ key, address, body, at, amountRial, direction, choice, chosenAt? }] } */
    @PluginMethod
    public void asked(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("on", SmsAsk.isOn(getContext()));
        ret.put("items", SmsAsk.items(getContext()));
        call.resolve(ret);
    }

    /** clearAsked({ keys }) — the web layer applied these; drops them (and an unanswered question's notification). */
    @PluginMethod
    public void clearAsked(PluginCall call) {
        JSArray keys = call.getArray("keys", new JSArray());
        Set<String> set = new HashSet<>();
        for (int i = 0; i < keys.length(); i++) {
            String k = keys.optString(i, null);
            if (k != null) set.add(k);
        }
        JSObject ret = new JSObject();
        ret.put("removed", SmsAsk.remove(getContext(), set));
        call.resolve(ret);
    }

    /** setAsk({ on }) — the app's «بپرس هنگام رسیدن پیامک» switch. */
    @PluginMethod
    public void setAsk(PluginCall call) {
        SmsAsk.setOn(getContext(), Boolean.TRUE.equals(call.getBoolean("on", true)));
        call.resolve();
    }

    /** launchRoute() -> { route } — the page a notification asked to open when it started the app (once). */
    @PluginMethod
    public void launchRoute(PluginCall call) {
        Activity a = getActivity();
        JSObject ret = new JSObject();
        String route = a == null ? null : takeRoute(a.getIntent());
        ret.put("route", route == null ? JSObject.NULL : route);
        call.resolve(ret);
    }

    /**
     * read({ sinceMs?: number, limit?: number }) -> { messages: [{ address, body, date }] }
     *
     * `sinceMs` lets the app ask only for what arrived after the last import, so a phone with
     * years of SMS doesn't re-read everything on every open. `limit` is capped so a runaway
     * call can't try to pull an entire inbox into a WebView message at once.
     */
    @PluginMethod
    public void read(PluginCall call) {
        if (!hasSms()) {
            call.reject("permission-denied");
            return;
        }
        long since = call.getLong("sinceMs", 0L);
        int limit = Math.min(call.getInt("limit", 500), 2000);

        JSArray out = new JSArray();
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                    INBOX,
                    new String[] { "address", "body", "date" },
                    since > 0 ? "date > ?" : null,
                    since > 0 ? new String[] { String.valueOf(since) } : null,
                    "date DESC LIMIT " + limit
            );
            if (c != null) {
                int iAddr = c.getColumnIndex("address");
                int iBody = c.getColumnIndex("body");
                int iDate = c.getColumnIndex("date");
                while (c.moveToNext()) {
                    JSONObject m = new JSONObject();
                    m.put("address", iAddr >= 0 ? c.getString(iAddr) : "");
                    m.put("body", iBody >= 0 ? c.getString(iBody) : "");
                    m.put("date", iDate >= 0 ? c.getLong(iDate) : 0L);
                    out.put(m);
                }
            }
            JSObject ret = new JSObject();
            ret.put("messages", out);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read-failed: " + e.getMessage(), e);
        } finally {
            if (c != null) c.close();
        }
    }
}
