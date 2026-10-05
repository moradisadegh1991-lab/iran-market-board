package ir.moradisadegh.marketboard;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import java.util.List;
import org.json.JSONObject;

/**
 * Why the app closed last time, so the next start can show it instead of the user only seeing «the app
 * closed» (the first report of the built-in voice was exactly that, with nothing to go on). Two sources:
 * a Java exception nobody caught (recorded here, by a handler that then lets Android end the app as before),
 * and — Android 11+ — the system's own exit record, which also covers native crashes (SIGSEGV in a .so) and ANRs.
 */
public final class CrashLog {
    static final String PREFS = "imf_crash";
    private static boolean installed;

    private CrashLog() {}

    public static synchronized void install(Context ctx) {
        if (installed) return;
        installed = true;
        Context app = ctx.getApplicationContext();
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
            record(app, thread.getName(), e);
            if (before != null) before.uncaughtException(thread, e);
        });
    }

    static void record(Context app, String thread, Throwable e) {
        try {
            app.getSharedPreferences(PREFS, 0).edit()
                .putLong("at", System.currentTimeMillis())
                .putString("thread", thread)
                .putString("stack", trim(Log.getStackTraceString(e), 3000))
                .commit(); // synchronous: the process ends right after
        } catch (Throwable ignored) {
            // nothing more can be done here
        }
    }

    /** Android 11+: did the app's last run end in a crash (Java or native)? null when the phone cannot say. */
    public static Boolean lastExitWasCrash(Context ctx) {
        ApplicationExitInfo x = lastExit(ctx);
        if (x == null) return Build.VERSION.SDK_INT >= 30 ? Boolean.FALSE : null;
        int r = x.getReason();
        return r == ApplicationExitInfo.REASON_CRASH || r == ApplicationExitInfo.REASON_CRASH_NATIVE;
    }

    private static ApplicationExitInfo lastExit(Context ctx) {
        if (Build.VERSION.SDK_INT < 30) return null;
        try {
            ActivityManager am = ctx.getSystemService(ActivityManager.class);
            List<ApplicationExitInfo> l = am.getHistoricalProcessExitReasons(null, 0, 1);
            return l == null || l.isEmpty() ? null : l.get(0);
        } catch (Throwable e) {
            return null;
        }
    }

    /** The last crash not yet shown, or null; each one is returned once. */
    public static JSONObject takeLast(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, 0);
        JSONObject out = new JSONObject();
        try {
            if (p.contains("stack")) {
                out.put("at", p.getLong("at", 0));
                out.put("thread", p.getString("thread", ""));
                out.put("stack", p.getString("stack", ""));
            }
            ApplicationExitInfo x = lastExit(ctx);
            if (x != null && x.getTimestamp() > p.getLong("seenExit", 0)) {
                p.edit().putLong("seenExit", x.getTimestamp()).apply();
                int r = x.getReason();
                String reason = r == ApplicationExitInfo.REASON_CRASH ? "crash"
                    : r == ApplicationExitInfo.REASON_CRASH_NATIVE ? "native-crash"
                    : r == ApplicationExitInfo.REASON_ANR ? "anr"
                    : r == ApplicationExitInfo.REASON_LOW_MEMORY ? "low-memory" : null;
                if (reason != null) {
                    out.put("reason", reason);
                    out.put("description", x.getDescription() == null ? "" : x.getDescription());
                    if (!out.has("at")) out.put("at", x.getTimestamp());
                }
            }
            p.edit().remove("stack").remove("thread").remove("at").apply();
        } catch (Exception ignored) {
            // a malformed record is not worth more
        }
        return out.length() == 0 ? null : out;
    }

    static String trim(String s, int n) {
        return s == null ? "" : s.length() <= n ? s : s.substring(0, n);
    }
}
