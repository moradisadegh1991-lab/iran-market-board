package ir.moradisadegh.marketboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.app.Application;
import androidx.test.core.app.ApplicationProvider;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import org.json.JSONObject;
import org.robolectric.shadows.ShadowActivityManager;
import static org.robolectric.Shadows.shadowOf;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * The built-in Persian voice's Java side (the engine itself is native and runs only on the phone; its model and
 * files are checked by scripts/tts-smoke.py with the same sherpa-onnx version): the text it is given, and the
 * one-time copy of the voice from the APK's assets into the app's storage.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class TtsTest {

    @Test
    public void textKeepsPersianAndPunctuationDropsSymbols() {
        assertEquals("دلار آزاد الان دویست هزار تومان؛ امروز بالا رفته.", TtsText.prepare("  دلار آزاد الان دویست هزار تومان؛ امروز بالا رفته.  "));
        assertEquals("ثبت کنم؟", TtsText.prepare("ثبت کنم؟"));
        // ZWNJ stays (حساب‌های), symbols and emoji become at most a pause, quotes go
        assertEquals("حساب\u200cهای خودت", TtsText.prepare("«حساب\u200cهای» 🎙 خودت"));
        assertEquals("BTC و ۲.۵", TtsText.prepare("BTC و ۲٫۵"));
        assertEquals("", TtsText.prepare("  🎙 "));
        assertEquals("", TtsText.prepare(null));
    }

    @Test
    public void voiceIsCopiedOnceAndAgainOnlyForANewVersion() throws Exception {
        Application app = ApplicationProvider.getApplicationContext();
        assumeTrue("this build carries the voice (fetch-tts.mjs + wire-native-plugin.mjs)", TtsFiles.shipped(app));
        File dir = TtsFiles.ensure(app);
        File model = new File(dir, "model.onnx");
        assertTrue(model.length() > 10_000_000);
        assertTrue(new File(dir, "tokens.txt").isFile());
        assertTrue(new File(dir, "espeak-ng-data/phontab").isFile());
        assertTrue(new File(dir, "espeak-ng-data/fa_dict").isFile());
        assertTrue(new File(dir, "espeak-ng-data/lang/ira/fa").isFile());
        long when = model.lastModified();
        Thread.sleep(1100);
        TtsFiles.ensure(app);
        assertEquals("not copied again", when, model.lastModified());
        // an app update with another voice version copies it again
        try (FileOutputStream out = new FileOutputStream(new File(dir, "VERSION"))) {
            out.write("old".getBytes());
        }
        TtsFiles.ensure(app);
        assertTrue(model.lastModified() > when);
    }

    @Test
    public void anApkWithoutTheVoiceFallsBackQuietly() {
        // EmbeddedTts is looked up by name; without the voice the plugin gets null and uses the phone's engine
        Application app = ApplicationProvider.getApplicationContext();
        VoicePlugin.Speaker s = VoicePlugin.loadBuiltIn(app);
        if (!TtsFiles.shipped(app)) assertEquals(null, s);
    }

    @Test
    public void oneAnswerIsSpokenSentenceBySentence() {
        assertEquals(
            Arrays.asList("دلار آزاد الان دویست هزار تومان؛", "امروز بالا رفته.", "ثبت کنم؟"),
            TtsText.sentences("دلار آزاد الان دویست هزار تومان؛ امروز بالا رفته. ثبت کنم؟")
        );
        assertEquals(Arrays.asList("بدون نقطه پایانی"), TtsText.sentences("بدون نقطه پایانی"));
        assertEquals(Arrays.asList(), TtsText.sentences(" . ؟ "));
        // a long sentence is also cut at «،», so the first sound comes sooner
        String longOne = "سی و پنج هزار تومان هزینه، دسته خوراک، از کیف پول نقد، دیروز، بابت نون و پنیر و سبزی و میوه برای خانه، ثبت کنم؟";
        assertTrue(TtsText.sentences(longOne).size() >= 2);
        assertEquals(TtsText.prepare(longOne), String.join(" ", TtsText.sentences(longOne)));
    }

    /** The note was left by an earlier process (a phase of this very process is never taken for a crash). */
    private static void nextRun(Application app) {
        app.getSharedPreferences(TtsGuard.PREFS, 0).edit().putInt("pid", -42).commit();
    }

    @Test
    public void aCrashInsideTheEngineTurnsTheVoiceOffAtTheNextStart() {
        Application app = ApplicationProvider.getApplicationContext();
        TtsGuard.reset(app);
        // a normal run: entered and left — nothing happens
        TtsGuard.enter(app, "speak");
        TtsGuard.leave(app);
        TtsGuard.check(app, Boolean.TRUE);
        assertTrue(!TtsGuard.off(app));
        // the process died while speaking, and the phone says it was a crash → off, with the reason (checked by the next run)
        TtsGuard.enter(app, "speak");
        nextRun(app);
        TtsGuard.check(app, Boolean.TRUE);
        assertTrue(TtsGuard.off(app));
        assertEquals("اپ هنگام ساختن صدا با صدای داخلی بسته شد", TtsGuard.why(app));
        TtsGuard.reset(app);
        // swiped away while speaking (Android 11+ says: not a crash) → stays on
        TtsGuard.enter(app, "speak");
        nextRun(app);
        TtsGuard.check(app, Boolean.FALSE);
        assertTrue(!TtsGuard.off(app));
        // an older phone that cannot tell → treated as a crash, the safe side
        TtsGuard.enter(app, "load");
        nextRun(app);
        TtsGuard.check(app, null);
        assertTrue(TtsGuard.off(app));
        assertEquals("اپ هنگام آماده کردن صدای داخلی بسته شد", TtsGuard.why(app));
        TtsGuard.reset(app);
        assertTrue(!TtsGuard.off(app));
    }

    @Test
    public void whyTheAppClosedIsKeptForTheNextStartAndShownOnce() throws Exception {
        Application app = ApplicationProvider.getApplicationContext();
        app.getSharedPreferences(CrashLog.PREFS, 0).edit().clear().commit();
        // an uncaught Java exception: recorded, then handed on to Android's own handler
        Throwable[] passed = new Throwable[1];
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> passed[0] = e);
        try {
            CrashLog.install(app);
            IllegalStateException boom = new IllegalStateException("boom");
            Thread.getDefaultUncaughtExceptionHandler().uncaughtException(new Thread("voice-worker"), boom);
            assertEquals(boom, passed[0]);
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(before);
        }
        // the system's record of a native crash (Android 11+)
        ActivityManager am = app.getSystemService(ActivityManager.class);
        ShadowActivityManager sam = shadowOf(am);
        sam.addApplicationExitInfo(org.robolectric.shadows.ShadowActivityManager.ApplicationExitInfoBuilder.newBuilder()
            .setReason(ApplicationExitInfo.REASON_CRASH_NATIVE).setTimestamp(System.currentTimeMillis()).setDescription("signal 11 (SIGSEGV)").build());
        assertEquals(Boolean.TRUE, CrashLog.lastExitWasCrash(app));
        JSONObject c = CrashLog.takeLast(app);
        assertEquals("voice-worker", c.getString("thread"));
        assertTrue(c.getString("stack").contains("IllegalStateException: boom"));
        assertEquals("native-crash", c.getString("reason"));
        assertEquals("signal 11 (SIGSEGV)", c.getString("description"));
        assertEquals("shown once", null, CrashLog.takeLast(app));
    }
}
