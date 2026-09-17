package ir.moradisadegh.marketboard;

import android.Manifest;
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
import org.json.JSONObject;

/**
 * Reads the SMS inbox so the web layer can parse bank messages.
 *
 * Deliberately minimal: it returns raw message bodies and nothing else. All parsing,
 * classification and storage happen in JavaScript (sms-parser.js), which is covered by
 * scripts/sms-parser-test.mjs — keeping the untestable native surface as small as possible.
 *
 * It only ever READS. There is no send, no delete, and no network call here: the bodies
 * never leave the device.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS })
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final Uri INBOX = Uri.parse("content://sms/inbox");

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasSms());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasSms()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("sms", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasSms());
        call.resolve(ret);
    }

    private boolean hasSms() {
        return getContext().checkSelfPermission(Manifest.permission.READ_SMS)
                == PackageManager.PERMISSION_GRANTED;
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
