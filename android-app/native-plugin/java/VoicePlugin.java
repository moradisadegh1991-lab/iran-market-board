package ir.moradisadegh.marketboard;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Persian speech for the voice assistant (lib/voice-io.ts → lib/finance/voice.ts): hears what the user
 * says with Android's speech recogniser, and reads the assistant's questions aloud with the phone's
 * text-to-speech when it has a Persian voice.
 *
 * Android WebView has no Web Speech API, hence this plugin. The understanding of the words happens in
 * JavaScript; here only text comes in and goes out. The recogniser is the phone's own service —
 * Google's when installed, since a maker's default (Samsung's) often has no Persian; it may send the
 * audio to its own servers, which the screen says. Nothing goes to this app's server.
 *
 * listen()       → { matches: string[] } best first, with "partial" events while the user speaks
 * listenDialog() → the same through Google's own voice-typing screen, for phones where the in-app
 *                  recogniser refuses Persian
 * speak({text})  → resolves when the sentence has been said (or was cut off by the next one)
 */
@CapacitorPlugin(name = "Voice", permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) })
public class VoicePlugin extends Plugin {

    static final String LANG = "fa-IR";
    static final Locale FA = Locale.forLanguageTag("fa-IR");
    static final String GOOGLE_TTS = "com.google.android.tts";

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall listenCall;
    private TextToSpeech tts;
    private boolean ttsFa;
    private String ttsEngine;
    private boolean triedGoogleTts;
    private final Map<String, PluginCall> speaking = new HashMap<>();

    @Override
    public void load() {
        initTts(null);
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::destroyRecognizer);
        if (tts != null) tts.shutdown();
        tts = null;
    }

    // ── which recogniser ────────────────────────────────────────────────────

    /** Google's recogniser understands Persian; prefer it over the phone maker's. Null = the system default. */
    static ComponentName pickRecognizer(List<ComponentName> services) {
        String[] prefer = { "com.google.android.googlequicksearchbox", "com.google.android.tts", "com.google.android.as" };
        for (String pkg : prefer) for (ComponentName c : services) if (pkg.equals(c.getPackageName())) return c;
        return null;
    }

    static List<ComponentName> recognitionServices(Context ctx) {
        List<ComponentName> out = new ArrayList<>();
        List<ResolveInfo> found = ctx.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
        if (found != null) for (ResolveInfo r : found) if (r.serviceInfo != null) out.add(new ComponentName(r.serviceInfo.packageName, r.serviceInfo.name));
        return out;
    }

    static Intent recognizeIntent(Context ctx, String prompt) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, LANG);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, LANG);
        i.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
        if (prompt != null && !prompt.isEmpty()) i.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
        return i;
    }

    /** SpeechRecognizer error → a short code the web layer acts on. */
    static String errorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-match";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "permission";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
            case 11: // ERROR_SERVER_DISCONNECTED (API 31)
                return "network";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
            case 10: // ERROR_TOO_MANY_REQUESTS (API 31)
                return "busy";
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED (API 31)
            case 13: // ERROR_LANGUAGE_UNAVAILABLE (API 31)
                return "language";
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio";
            default:
                return "client";
        }
    }

    private boolean micGranted() {
        return getPermissionState("mic") == PermissionState.GRANTED;
    }

    // ── methods ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void available(PluginCall call) {
        Context ctx = getContext();
        ComponentName svc = pickRecognizer(recognitionServices(ctx));
        JSObject ret = new JSObject();
        ret.put("recognition", SpeechRecognizer.isRecognitionAvailable(ctx));
        ret.put("service", svc == null ? null : svc.getPackageName());
        ret.put("dialog", ctx.getPackageManager().resolveActivity(recognizeIntent(ctx, null), PackageManager.MATCH_DEFAULT_ONLY) != null);
        ret.put("mic", micGranted());
        ret.put("tts", ttsFa);
        ret.put("ttsEngine", ttsEngine);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestMic(PluginCall call) {
        if (micGranted()) {
            JSObject ret = new JSObject();
            ret.put("mic", true);
            call.resolve(ret);
        } else requestPermissionForAlias("mic", call, "micResult");
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("mic", micGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (!micGranted()) {
            call.reject("دسترسی میکروفون داده نشده", "permission");
            return;
        }
        String prompt = call.getString("prompt");
        main.post(() -> {
            if (listenCall != null) listenCall.reject("گوش دادن قبلی قطع شد", "cancelled");
            destroyRecognizer();
            Context ctx = getContext();
            ComponentName svc = pickRecognizer(recognitionServices(ctx));
            if (svc == null && !SpeechRecognizer.isRecognitionAvailable(ctx)) {
                call.reject("سرویس تشخیص گفتار روی گوشی نیست", "unavailable");
                return;
            }
            recognizer = svc != null ? SpeechRecognizer.createSpeechRecognizer(ctx, svc) : SpeechRecognizer.createSpeechRecognizer(ctx);
            listenCall = call;
            recognizer.setRecognitionListener(new Listener());
            recognizer.startListening(recognizeIntent(ctx, prompt));
        });
    }

    /** Stop listening and use what was heard so far. */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            if (recognizer != null) recognizer.stopListening();
        });
        call.resolve();
    }

    /** Stop listening and drop it. */
    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            if (recognizer != null) recognizer.cancel();
            if (listenCall != null) listenCall.reject("لغو شد", "cancelled");
            listenCall = null;
        });
        call.resolve();
    }

    @PluginMethod
    public void listenDialog(PluginCall call) {
        Intent i = recognizeIntent(getContext(), call.getString("prompt"));
        if (getContext().getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY) == null) {
            call.reject("صفحه تایپ صوتی گوگل روی گوشی نیست", "unavailable");
            return;
        }
        startActivityForResult(call, i, "dialogResult");
    }

    @ActivityCallback
    private void dialogResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ArrayList<String> m = result.getData() == null ? null : result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (result.getResultCode() == Activity.RESULT_OK && m != null && !m.isEmpty()) call.resolve(matches(m));
        else call.reject("چیزی شنیده نشد", "no-match");
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (tts == null || !ttsFa) {
            call.reject("صدای فارسی روی گوشی نیست", "tts");
            return;
        }
        String id = UUID.randomUUID().toString();
        synchronized (speaking) {
            speaking.put(id, call);
        }
        Bundle params = new Bundle();
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, id) != TextToSpeech.SUCCESS) {
            finishUtterance(id, false);
        }
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    // ── recogniser callbacks ────────────────────────────────────────────────

    static JSObject matches(List<String> m) {
        JSArray arr = new JSArray();
        if (m != null) for (String s : m) if (s != null && !s.trim().isEmpty()) arr.put(s);
        JSObject ret = new JSObject();
        ret.put("matches", arr);
        return ret;
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    private class Listener implements RecognitionListener {
        private void state(String s) {
            JSObject e = new JSObject();
            e.put("state", s);
            notifyListeners("state", e);
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            state("listening");
        }

        @Override
        public void onBeginningOfSpeech() {
            state("speech");
        }

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            state("processing");
        }

        @Override
        public void onError(int error) {
            PluginCall c = listenCall;
            listenCall = null;
            destroyRecognizer();
            if (c != null) c.reject("خطای تشخیص گفتار " + error, errorCode(error));
        }

        @Override
        public void onResults(Bundle results) {
            PluginCall c = listenCall;
            listenCall = null;
            ArrayList<String> m = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            destroyRecognizer();
            if (c == null) return;
            if (m == null || m.isEmpty()) c.reject("چیزی شنیده نشد", "no-match");
            else c.resolve(matches(m));
        }

        @Override
        public void onPartialResults(Bundle partial) {
            ArrayList<String> m = partial == null ? null : partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (m == null || m.isEmpty()) return;
            JSObject e = new JSObject();
            e.put("text", m.get(0));
            notifyListeners("partial", e);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }

    // ── text to speech ──────────────────────────────────────────────────────

    /** The default engine first; if it has no Persian and Google's engine is installed, that one. */
    private void initTts(String engine) {
        TextToSpeech.OnInitListener onInit = status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) return;
            int r = tts.setLanguage(FA);
            ttsFa = r >= TextToSpeech.LANG_AVAILABLE;
            ttsEngine = tts.getDefaultEngine();
            if (engine != null) ttsEngine = engine;
            if (!ttsFa && !triedGoogleTts && !GOOGLE_TTS.equals(ttsEngine) && hasEngine(tts, GOOGLE_TTS)) {
                triedGoogleTts = true;
                tts.shutdown();
                initTts(GOOGLE_TTS);
                return;
            }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {}

                @Override
                public void onDone(String id) {
                    finishUtterance(id, true);
                }

                @Override
                public void onError(String id) {
                    finishUtterance(id, false);
                }

                @Override
                public void onStop(String id, boolean interrupted) {
                    finishUtterance(id, true);
                }
            });
        };
        tts = engine == null ? new TextToSpeech(getContext(), onInit) : new TextToSpeech(getContext(), onInit, engine);
    }

    static boolean hasEngine(TextToSpeech t, String pkg) {
        for (TextToSpeech.EngineInfo e : t.getEngines()) if (pkg.equals(e.name)) return true;
        return false;
    }

    private void finishUtterance(String id, boolean ok) {
        PluginCall c;
        synchronized (speaking) {
            c = speaking.remove(id);
        }
        if (c == null) return;
        if (ok) c.resolve();
        else c.reject("خواندن متن ممکن نشد", "tts");
    }
}
