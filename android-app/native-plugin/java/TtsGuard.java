package ir.moradisadegh.marketboard;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * A native crash in the built-in voice cannot be caught: it ends the whole app. So the voice writes down
 * when it enters the engine («load», «speak») and clears it when it comes back. A note still there at the next
 * start means the app died inside the engine; if the phone confirms it was a crash (Android 11+; older phones
 * cannot tell a crash from being swiped away, and are taken at their word), the built-in voice is turned off
 * — the assistant keeps working and says why — instead of closing the app again on every answer.
 */
public final class TtsGuard {
    static final String PREFS = "imf_tts";

    private TtsGuard() {}

    private static SharedPreferences p(Context ctx) {
        return ctx.getSharedPreferences(PREFS, 0);
    }

    /** «load» / «speak» (the voice), «wake» (the «مالی من» listener, rule 75) — with the process, so a phase still in progress in this run is never taken for a crash */
    public static void enter(Context ctx, String phase) {
        p(ctx).edit().putString("phase", phase).putInt("pid", android.os.Process.myPid()).commit();
    }

    public static void leave(Context ctx) {
        p(ctx).edit().remove("phase").remove("pid").commit();
    }

    /** At startup, before the voice is created: a phase left behind turns the voice off when that run crashed. */
    public static void check(Context ctx, Boolean lastRunCrashed) {
        String phase = p(ctx).getString("phase", null);
        if (phase == null || p(ctx).getInt("pid", -1) == android.os.Process.myPid()) return;
        leave(ctx);
        if ("wake".equals(phase)) {
            // only the listener goes off; the voice is not to blame
            if (lastRunCrashed == null || lastRunCrashed) p(ctx).edit().putBoolean("wakeOff", true).commit();
            return;
        }
        if (lastRunCrashed == null || lastRunCrashed) {
            String why = "load".equals(phase) ? "اپ هنگام آماده کردن صدای داخلی بسته شد" : "اپ هنگام ساختن صدا با صدای داخلی بسته شد";
            p(ctx).edit().putBoolean("off", true).putString("why", why).commit();
        }
    }

    public static boolean off(Context ctx) {
        return p(ctx).getBoolean("off", false);
    }

    public static String why(Context ctx) {
        return p(ctx).getString("why", "صدای داخلی خاموش است");
    }

    /** «امتحان دوباره» on the screen. */
    public static void reset(Context ctx) {
        p(ctx).edit().remove("off").remove("why").remove("phase").remove("pid").commit();
    }

    /** The «مالی من» listener died in its native code last time: it stays off until turned on again. */
    public static boolean wakeOff(Context ctx) {
        return p(ctx).getBoolean("wakeOff", false);
    }

    public static void wakeReset(Context ctx) {
        p(ctx).edit().remove("wakeOff").commit();
    }
}
