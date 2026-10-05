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

    public static void enter(Context ctx, String phase) {
        p(ctx).edit().putString("phase", phase).commit();
    }

    public static void leave(Context ctx) {
        p(ctx).edit().remove("phase").commit();
    }

    /** At startup, before the voice is created: a phase left behind turns the voice off when that run crashed. */
    public static void check(Context ctx, Boolean lastRunCrashed) {
        String phase = p(ctx).getString("phase", null);
        if (phase == null) return;
        leave(ctx);
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
        p(ctx).edit().clear().commit();
    }
}
