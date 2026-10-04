package ir.moradisadegh.marketboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.app.Application;
import androidx.test.core.app.ApplicationProvider;
import java.io.File;
import java.io.FileOutputStream;
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
}
