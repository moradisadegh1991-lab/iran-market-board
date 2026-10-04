package ir.moradisadegh.marketboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Application;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.test.core.app.ApplicationProvider;
import com.getcapacitor.JSObject;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * The parts of VoicePlugin that decide things, on the real framework classes: which recogniser is used
 * (Google's over the phone maker's, since Samsung's has no Persian), what is asked of it (Persian only,
 * five guesses, partial results), how its errors reach the web layer, and what comes back.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class VoicePluginTest {

    @Test
    public void prefersGooglesRecogniserOverTheMakers() {
        ComponentName samsung = new ComponentName("com.samsung.android.bixby.agent", "com.samsung.android.bixby.SpeechService");
        ComponentName google = new ComponentName("com.google.android.googlequicksearchbox", "com.google.android.voicesearch.serviceapi.GoogleRecognitionService");
        ComponentName onDevice = new ComponentName("com.google.android.tts", "com.google.android.apps.speech.tts.googletts.service.GoogleTTSRecognitionService");
        assertEquals(google, VoicePlugin.pickRecognizer(Arrays.asList(samsung, onDevice, google)));
        assertEquals(onDevice, VoicePlugin.pickRecognizer(Arrays.asList(samsung, onDevice)));
        assertNull("only the maker's → the system default", VoicePlugin.pickRecognizer(Collections.singletonList(samsung)));
        assertNull(VoicePlugin.pickRecognizer(Collections.emptyList()));
    }

    @Test
    public void findsTheRecognitionServicesInstalled() {
        Application app = ApplicationProvider.getApplicationContext();
        ComponentName google = new ComponentName("com.google.android.googlequicksearchbox", "com.google.android.voicesearch.serviceapi.GoogleRecognitionService");
        ComponentName samsung = new ComponentName("com.samsung.android.bixby.agent", "com.samsung.android.bixby.SpeechService");
        for (ComponentName c : Arrays.asList(samsung, google)) {
            shadowOf(app.getPackageManager()).addServiceIfNotPresent(c);
            shadowOf(app.getPackageManager()).addIntentFilterForService(c, new IntentFilter(RecognitionService.SERVICE_INTERFACE));
        }
        List<ComponentName> found = VoicePlugin.recognitionServices(app);
        assertTrue(found.contains(google) && found.contains(samsung));
        assertEquals(google, VoicePlugin.pickRecognizer(found));
    }

    @Test
    public void asksForPersianOnlyWithAlternativesAndPartials() {
        Application app = ApplicationProvider.getApplicationContext();
        Intent i = VoicePlugin.recognizeIntent(app, "مبلغش چقدر بود؟");
        assertEquals(RecognizerIntent.ACTION_RECOGNIZE_SPEECH, i.getAction());
        assertEquals("fa-IR", i.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE));
        assertEquals("fa-IR", i.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE));
        assertTrue(i.getBooleanExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false));
        assertEquals(5, i.getIntExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 0));
        assertTrue(i.getBooleanExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false));
        assertEquals("مبلغش چقدر بود؟", i.getStringExtra(RecognizerIntent.EXTRA_PROMPT));
        assertEquals(app.getPackageName(), i.getStringExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE));
    }

    @Test
    public void errorsBecomeCodesTheWebLayerActsOn() {
        assertEquals("no-match", VoicePlugin.errorCode(SpeechRecognizer.ERROR_NO_MATCH));
        assertEquals("no-match", VoicePlugin.errorCode(SpeechRecognizer.ERROR_SPEECH_TIMEOUT));
        assertEquals("permission", VoicePlugin.errorCode(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS));
        assertEquals("network", VoicePlugin.errorCode(SpeechRecognizer.ERROR_NETWORK));
        assertEquals("network", VoicePlugin.errorCode(SpeechRecognizer.ERROR_SERVER_DISCONNECTED));
        assertEquals("busy", VoicePlugin.errorCode(SpeechRecognizer.ERROR_RECOGNIZER_BUSY));
        // the in-app recogniser without Persian → the web layer falls back to Google's voice-typing screen
        assertEquals("language", VoicePlugin.errorCode(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED));
        assertEquals("language", VoicePlugin.errorCode(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE));
        assertEquals("audio", VoicePlugin.errorCode(SpeechRecognizer.ERROR_AUDIO));
    }

    @Test
    public void triesEveryInstalledVoiceEngineForPersian() {
        // Samsung's default has no Persian: Google's next, then whatever else is installed (eSpeak NG, sherpa-onnx…)
        assertEquals(
            Arrays.asList("com.samsung.SMT", "com.google.android.tts", "com.reecedunn.espeak", "com.k2fsa.sherpa.onnx.tts.engine"),
            VoicePlugin.ttsOrder("com.samsung.SMT", Arrays.asList("com.reecedunn.espeak", "com.google.android.tts", "com.samsung.SMT", "com.k2fsa.sherpa.onnx.tts.engine"))
        );
        assertEquals(Arrays.asList("com.reecedunn.espeak"), VoicePlugin.ttsOrder("com.reecedunn.espeak", Collections.singletonList("com.reecedunn.espeak")));
        assertEquals(Collections.emptyList(), VoicePlugin.ttsOrder(null, Collections.emptyList()));
    }

    @Test
    public void returnsTheGuessesInOrderWithoutBlanks() throws Exception {
        JSObject r = VoicePlugin.matches(Arrays.asList("سی هزار تومان", " ", "سیاه", null));
        JSONArray m = r.getJSONArray("matches");
        assertEquals(2, m.length());
        assertEquals("سی هزار تومان", m.getString(0));
        assertEquals("سیاه", m.getString(1));
    }
}
