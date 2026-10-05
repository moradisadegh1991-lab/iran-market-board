package ir.moradisadegh.marketboard;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import java.io.IOException;
import java.io.InputStream;

/**
 * «مالی من» — the assistant called by name, the app open or not (CLAUDE.md rule 75). WakeService (only in an APK
 * built with the built-in voice, since it uses the same sherpa-onnx engine) keeps the microphone open in a
 * foreground service and runs a small on-device keyword spotter; nothing is recorded or sent anywhere.
 * Everything here is plain Android, so it is tested on Robolectric: the settings, the two measured
 * sensitivities, the silence gate that keeps the spotter idle in a quiet room, and what happens when the name
 * is heard.
 */
public final class Wake {
    static final String PREFS = "imf_wake";
    /** the always-there «listening» notification (a foreground service must show one): silent, at the bottom */
    static final String CHANNEL = "imb-wake";
    /** «heard you — tap to open», when the app may not bring itself up (locked phone, no overlay permission) */
    static final String CHANNEL_HEARD = "imb-wake-heard";
    static final int NOTE_ID = 7401;
    static final int HEARD_ID = 7402;
    static final String EXTRA_WAKE = "imf.wake";
    static final String ACTION_START = "imf.wake.START";
    static final String ACTION_STOP = "imf.wake.STOP";
    static final String ACTION_PAUSE = "imf.wake.PAUSE";
    static final String ACTION_RESUME = "imf.wake.RESUME";
    /** after the name was heard (or the assistant opened), listening comes back by itself at the latest after this */
    static final long AUTO_RESUME_MS = 3 * 60_000L;
    static final String KWS_DIR = "kws";

    /**
     * Measured, not guessed (rule 75; android-app/scripts/kws-eval.py): «مالی من» from six Persian TTS voices × three
     * speeds × four sentences (72 clips), against 27 minutes of other Persian speech. The model knows English phones,
     * so the name is spelled in them, with the ways a Persian «a» and «i» may come out. The TTS voices are random, so
     * a run moves by a few clips (an earlier run: sensitive 51/72).
     *  sensitive: 45 of 72 heard, 14 false wakes in 27 min — 13 on near-sounding words (این مال منه، ماهی من، مالی ندارم، مالکیت من)
     *  careful:   41 of 72 heard,  8 false wakes in 27 min — all near-sounding (این مال منه، ماهی من)
     */
    static final String[] SENSITIVE = {
        "M AA1 L IY0 M AE1 N @MALI_MAN", "M AA1 L IY1 M AE1 N @MALI_MAN", "M AA1 L IY0 M AH1 N @MALI_MAN",
        "M AA1 L IY0 M AA1 N @MALI_MAN", "M AO1 L IY0 M AE1 N @MALI_MAN",
    };
    static final String[] CAREFUL = { "M AA1 L IY0 M AE1 N @MALI_MAN" };

    static volatile boolean running;
    static volatile boolean paused;
    static volatile String error;

    private Wake() {}

    static SharedPreferences p(Context ctx) {
        return ctx.getSharedPreferences(PREFS, 0);
    }

    static boolean enabled(Context ctx) {
        return p(ctx).getBoolean("on", false);
    }

    static String sensitivity(Context ctx) {
        return "careful".equals(p(ctx).getString("sensitivity", "sensitive")) ? "careful" : "sensitive";
    }

    static void save(Context ctx, boolean on, String sensitivity) {
        SharedPreferences.Editor e = p(ctx).edit().putBoolean("on", on);
        if (sensitivity != null) e.putString("sensitivity", "careful".equals(sensitivity) ? "careful" : "sensitive");
        e.commit();
    }

    static String keywords(String sensitivity) {
        return String.join("\n", "careful".equals(sensitivity) ? CAREFUL : SENSITIVE) + "\n";
    }

    static float threshold(String sensitivity) {
        return "careful".equals(sensitivity) ? 0.25f : 0.2f;
    }

    static float boost(String sensitivity) {
        return "careful".equals(sensitivity) ? 1.0f : 3.0f;
    }

    /** WakeService by name: it exists only in an APK built with the built-in voice (wire-native-plugin.mjs). */
    static Class<?> serviceClass() {
        try {
            return Class.forName(Wake.class.getPackage().getName() + ".WakeService");
        } catch (Throwable t) {
            return null;
        }
    }

    /** This APK can listen for the name: the service and the spotter's model are in it. */
    static boolean shipped(Context ctx) {
        if (serviceClass() == null) return false;
        try (InputStream in = ctx.getAssets().open(TtsFiles.ASSETS + "/" + KWS_DIR + "/tokens.txt")) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** «نمایش روی برنامه‌های دیگر»: without it Android does not let the app bring itself up from the background. */
    static boolean overlay(Context ctx) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx);
    }

    static Intent serviceIntent(Context ctx, String action) {
        Class<?> c = serviceClass();
        return c == null ? null : new Intent(ctx, c).setAction(action);
    }

    /** Start listening. Android 14+ allows it only while the app is on screen: called from the page. */
    static void start(Context ctx) {
        Intent i = serviceIntent(ctx, ACTION_START);
        if (i == null) throw new IllegalStateException("این نسخه اپ شنیدن «مالی من» را ندارد");
        error = null;
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    /** Stop, pause or resume a running service; nothing when it is not running. */
    static void send(Context ctx, String action) {
        if (!running) return;
        Intent i = serviceIntent(ctx, action);
        if (i == null) return;
        try {
            ctx.startService(i);
        } catch (Throwable ignored) {
            // the app is in the background: the service resumes by itself (AUTO_RESUME_MS)
        }
    }

    static int smallIcon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_mali", "drawable", ctx.getPackageName());
        return id != 0 ? id : android.R.drawable.ic_btn_speak_now;
    }

    private static int immutable() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    /** Each channel is created before anything is posted to it (rule 14). */
    static void channels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "در انتظار «مالی من»", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("وقتی شنیدن «مالی من» روشن است، اندروید این اعلان را لازم دارد");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_HEARD) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_HEARD, "«مالی من» شنیده شد", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("وقتی اپ نمی‌تواند خودش باز شود (گوشی قفل است یا اجازه نمایش روی برنامه‌ها نیست)");
            nm.createNotificationChannel(ch);
        }
    }

    static Intent assistIntent(Context ctx) {
        return AssistTile.assistIntent(ctx).putExtra(EXTRA_WAKE, true);
    }

    private static Notification.Builder builder(Context ctx, String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, channel) : new Notification.Builder(ctx);
    }

    /** The foreground service's notification: what it is doing, and «خاموش». */
    static Notification listening(Context ctx) {
        channels(ctx);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        Intent stop = serviceIntent(ctx, ACTION_STOP);
        Notification.Builder b = builder(ctx, CHANNEL)
            .setSmallIcon(smallIcon(ctx))
            .setContentTitle(paused ? "شنیدن «مالی من» — مکث تا بسته شدن دستیار" : "در انتظار «مالی من»")
            .setContentText("بگویید «مالی من» تا دستیار باز شود. صدا روی گوشی می‌ماند.")
            .setOngoing(true)
            .setShowWhen(false);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_MIN);
        if (open != null) b.setContentIntent(PendingIntent.getActivity(ctx, 7410, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
        if (stop != null) b.addAction(new Notification.Action.Builder(null, "خاموش", PendingIntent.getService(ctx, 7411, stop, PendingIntent.FLAG_UPDATE_CURRENT | immutable())).build());
        return b.build();
    }

    static boolean locked(Context ctx) {
        KeyguardManager km = ctx.getSystemService(KeyguardManager.class);
        return km != null && km.isKeyguardLocked();
    }

    /**
     * The name was heard: bring the assistant up, listening. Android lets a background app open itself only with
     * «نمایش روی برنامه‌های دیگر» — and from Android 15 only while one of its overlay windows is visible, so a
     * 1-pixel see-through one is shown for a moment. Otherwise (no permission, phone locked, refused): a heads-up
     * notification to tap. Returns how: "opened" or "notified".
     */
    static String heard(Context ctx) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            // windows and activities are started from the main thread; the spotter runs on its own
            final Context c = ctx.getApplicationContext();
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    heard(c);
                } catch (Throwable ignored) {
                    // never take the app down
                }
            });
            return "posted";
        }
        Intent i = assistIntent(ctx);
        if (overlay(ctx) && !locked(ctx)) {
            try {
                openOver(ctx, i);
                return "opened";
            } catch (Throwable ignored) {
                // fall through to the notification
            }
        }
        notifyHeard(ctx, i);
        return "notified";
    }

    private static void openOver(Context ctx, Intent i) {
        Context app = ctx.getApplicationContext();
        WindowManager wm = app.getSystemService(WindowManager.class);
        View dot = null;
        if (wm != null && Build.VERSION.SDK_INT >= 26) {
            try {
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(1, 1, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSLUCENT);
                dot = new View(app);
                wm.addView(dot, lp);
            } catch (Throwable t) {
                dot = null; // the start below may still be allowed (Android 14 and older)
            }
        }
        try {
            app.startActivity(i);
        } finally {
            if (dot != null) {
                final View v = dot;
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        wm.removeView(v);
                    } catch (Throwable ignored) {
                        // already gone
                    }
                }, 1500);
            }
        }
    }

    static void notifyHeard(Context ctx, Intent i) {
        try {
            channels(ctx);
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm == null) return;
            PendingIntent pi = PendingIntent.getActivity(ctx, 7412, i, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
            Notification.Builder b = builder(ctx, CHANNEL_HEARD)
                .setSmallIcon(smallIcon(ctx))
                .setContentTitle("«مالی من» را شنیدم")
                .setContentText("برای صحبت با دستیار لمس کنید")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setTimeoutAfter(60_000)
                .setCategory(Notification.CATEGORY_CALL);
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
            nm.notify(HEARD_ID, b.build());
        } catch (Throwable ignored) {
            // no notification permission: nothing more to do
        }
    }

    /**
     * The spotter costs about 5% of a phone core while it runs (measured: real-time factor 0.049 on one core),
     * so it only runs while there is sound. Chunks below the gate are skipped; when sound comes back, the last
     * half second before it is fed first, so the start of «مالی» is not lost; after 1.2 s of quiet the spotter
     * rests again (and its stream is reset). The floor follows the room's own noise, so a fan does not keep it on.
     */
    static final class Gate {
        static final float MIN_OPEN = 0.004f; // ≈ −48 dBFS: a quiet room stays below, speech at arm's length is above
        static final int PRE_ROLL = 5; // chunks of 100 ms
        static final int HANGOVER = 12;
        private final float[][] ring = new float[PRE_ROLL][];
        private int ringN;
        private int ringAt;
        private int quiet = HANGOVER;
        float floor = 0.002f;

        static float rms(float[] x) {
            double s = 0;
            for (float v : x) s += v * v;
            return x.length == 0 ? 0f : (float) Math.sqrt(s / x.length);
        }

        /** What to feed the spotter for this chunk (oldest first), or null to skip it. reset tells whether a new utterance starts. */
        float[][] push(float[] chunk, boolean[] reset) {
            float r = rms(chunk);
            // the noise floor creeps up slowly and drops at once: it settles on the room, not on speech
            floor = r < floor ? r : floor * 1.002f + 1e-6f;
            boolean loud = r > Math.max(MIN_OPEN, floor * 3f);
            reset[0] = false;
            if (loud) {
                float[][] out;
                if (quiet >= HANGOVER) {
                    // waking up: the pre-roll, then this chunk
                    out = new float[ringN + 1][];
                    for (int k = 0; k < ringN; k++) out[k] = ring[(ringAt - ringN + k + PRE_ROLL) % PRE_ROLL];
                    out[ringN] = chunk;
                    reset[0] = true;
                } else out = new float[][] { chunk };
                quiet = 0;
                ringN = 0;
                return out;
            }
            if (quiet < HANGOVER) {
                quiet++;
                return new float[][] { chunk };
            }
            ring[ringAt] = chunk;
            ringAt = (ringAt + 1) % PRE_ROLL;
            ringN = Math.min(PRE_ROLL, ringN + 1);
            return null;
        }

        boolean active() {
            return quiet < HANGOVER;
        }
    }
}
