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
 * speak({text})  → resolves when the sentence has been said (or was cut off by the next one): with the app's
 *                  own Persian voice (EmbeddedTts, sherpa-onnx — CLAUDE.md rule 71) when the APK carries it,
 *                  otherwise with a Persian voice of the phone's TTS engines
 */
@CapacitorPlugin(name = "Voice", permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) })
public class VoicePlugin extends Plugin {

    static final String LANG = "fa-IR";
    static final Locale FA = Locale.forLanguageTag("fa-IR");
    static final String GOOGLE_TTS = "com.google.android.tts";
    /** the app's own «open the assistant» action: the quick-settings tile and the icon shortcut (rule 74) */
    static final String ACTION_ASSIST = "ir.moradisadegh.marketboard.ASSIST";

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private ComponentName recognizerSvc;
    private PluginCall listenCall;
    private TextToSpeech tts;
    private boolean ttsFa;
    private String ttsEngine;
    private final List<String> ttsTried = new ArrayList<>();
    private List<String> ttsInstalled = new ArrayList<>();
    private final Map<String, PluginCall> speaking = new HashMap<>();
    /** the app was opened to talk to the assistant (assist gesture, tile, shortcut) and the page has not taken it yet */
    private volatile boolean pendingAssist;
    /** the built-in voice, or null when this APK was built without it */
    private Speaker builtIn;

    /** A voice the plugin can speak with besides the phone's TextToSpeech. */
    public interface Speaker {
        /** start loading the engine in the background (once) */
        void warm();

        boolean ok();

        String error();

        void speak(String text, SpeakDone done);

        void stop();

        void shutdown();
    }

    public interface SpeakDone {
        void finished(boolean interrupted);

        void failed(String why);
    }

    /** EmbeddedTts by name: it exists only in an APK built with the voice (wire-native-plugin.mjs). */
    static Speaker loadBuiltIn(Context ctx) {
        try {
            Class<?> c = Class.forName(VoicePlugin.class.getPackage().getName() + ".EmbeddedTts");
            return (Speaker) c.getConstructor(Context.class).newInstance(ctx);
        } catch (Throwable t) {
            return null;
        }
    }

    @Override
    public void load() {
        Context ctx = getContext();
        CrashLog.install(ctx);
        try {
            if (getActivity() != null && takeAssistFrom(getActivity().getIntent())) pendingAssist = true;
        } catch (Throwable ignored) {
            // no launch intent to read
        }
        // the last run died inside the built-in voice's native code: keep it off until the user retries
        TtsGuard.check(ctx, CrashLog.lastExitWasCrash(ctx));
        builtIn = loadBuiltIn(ctx);
        try {
            initTts(null);
        } catch (Throwable t) {
            ttsFa = false;
        }
    }

    /**
     * Was the app opened to talk to the assistant? The phone's assist gesture (long-press the side or home key, when
     * «مالی من» is the default digital assistant: ACTION_ASSIST), a headset's voice button (VOICE_COMMAND), the
     * quick-settings tile and the icon shortcut (ACTION_ASSIST of this app).
     */
    static boolean isAssist(Intent i) {
        if (i == null || i.getAction() == null) return false;
        String a = i.getAction();
        return Intent.ACTION_ASSIST.equals(a) || Intent.ACTION_VOICE_COMMAND.equals(a) || ACTION_ASSIST.equals(a);
    }

    /** isAssist, and the intent is marked used so a rotation or a return to the app does not open it again. */
    static boolean takeAssistFrom(Intent i) {
        if (!isAssist(i)) return false;
        i.setAction(Intent.ACTION_MAIN);
        return true;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (!takeAssistFrom(intent)) return;
        // the page is up and listening → tell it now; otherwise it asks with takeAssist once it is
        if (hasListeners("assist")) notifyListeners("assist", new JSObject());
        else pendingAssist = true;
    }

    /** The page asks once it is up: «open the assistant and listen». */
    @PluginMethod
    public void takeAssist(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("assist", pendingAssist);
        pendingAssist = false;
        call.resolve(ret);
    }

    /** Why the app closed last time (once), for the assistant to show: CrashLog. */
    @PluginMethod
    public void lastCrash(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            org.json.JSONObject c = CrashLog.takeLast(getContext());
            if (c != null) ret.put("crash", JSObject.fromJSONObject(c));
        } catch (Throwable ignored) {
            // nothing to show
        }
        call.resolve(ret);
    }

    /** «امتحان دوباره» after the built-in voice was turned off or failed. */
    @PluginMethod
    public void retryBuiltIn(PluginCall call) {
        TtsGuard.reset(getContext());
        if (builtIn != null) builtIn.shutdown();
        builtIn = loadBuiltIn(getContext());
        if (builtIn != null) builtIn.warm();
        available(call);
    }

    private boolean builtInOk() {
        return builtIn != null && builtIn.ok();
    }

    /** Back from the phone's settings (a Persian voice may have been installed): look again. */
    @Override
    protected void handleOnResume() {
        if (!ttsFa && tts != null) {
            try {
                ttsTried.clear();
                tts.shutdown();
                tts = null;
                initTts(null);
            } catch (Throwable ignored) {
                // the phone's engines stay as they were
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::destroyRecognizer);
        if (builtIn != null) builtIn.shutdown();
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
        if (builtIn != null) builtIn.warm(); // the assistant opened: get the voice ready for its first answer
        ret.put("tts", builtInOk() || ttsFa);
        ret.put("ttsEngine", builtInOk() ? "built-in" : ttsEngine);
        ret.put("builtIn", builtIn != null);
        if (builtIn != null && !builtIn.ok()) ret.put("builtInError", builtIn.error());
        JSArray engines = new JSArray();
        for (String e : ttsInstalled) engines.put(e);
        ret.put("ttsEngines", engines);
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
          try {
            if (listenCall != null) listenCall.reject("گوش دادن قبلی قطع شد", "cancelled");
            listenCall = null;
            Context ctx = getContext();
            ComponentName svc = pickRecognizer(recognitionServices(ctx));
            if (svc == null && !SpeechRecognizer.isRecognitionAvailable(ctx)) {
                call.reject("سرویس تشخیص گفتار روی گوشی نیست", "unavailable");
                return;
            }
            // one recogniser for the whole conversation: destroying and re-binding Google's service between
            // two questions made the second listen fail with a «network» error on a real phone
            boolean same = recognizer != null && (svc == null ? recognizerSvc == null : svc.equals(recognizerSvc));
            if (same) recognizer.cancel();
            else {
                destroyRecognizer();
                recognizer = svc != null ? SpeechRecognizer.createSpeechRecognizer(ctx, svc) : SpeechRecognizer.createSpeechRecognizer(ctx);
                recognizerSvc = svc;
                recognizer.setRecognitionListener(new Listener());
            }
            listenCall = call;
            recognizer.startListening(recognizeIntent(ctx, prompt));
          } catch (Throwable t) {
            listenCall = null;
            destroyRecognizer();
            call.reject("تشخیص گفتار شروع نشد: " + t.getClass().getSimpleName(), "client");
          }
        });
    }

    /** Stop listening and use what was heard so far. */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            try {
                if (recognizer != null) recognizer.stopListening();
            } catch (Throwable ignored) {
                // nothing to stop
            }
        });
        call.resolve();
    }

    /** Stop listening and drop it. */
    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            try {
                if (recognizer != null) recognizer.cancel();
            } catch (Throwable ignored) {
                // nothing to cancel
            }
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
        if (builtInOk()) {
            builtIn.speak(text, new SpeakDone() {
                @Override
                public void finished(boolean interrupted) {
                    call.resolve();
                }

                @Override
                public void failed(String why) {
                    // the built-in voice failed on this phone: the phone's own Persian voice, if any
                    if (tts != null && ttsFa) speakSystem(call, text);
                    else call.reject(why, "tts");
                }
            });
            return;
        }
        speakSystem(call, text);
    }

    private void speakSystem(PluginCall call, String text) {
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
        if (builtIn != null) builtIn.stop();
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
            try {
                recognizer.destroy();
            } catch (Throwable ignored) {
                // already gone
            }
            recognizer = null;
            recognizerSvc = null;
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
            // after anything but «heard nothing», start the next listen on a fresh connection
            if (!"no-match".equals(errorCode(error))) destroyRecognizer();
            if (c != null) c.reject("خطای تشخیص گفتار " + error, errorCode(error));
        }

        @Override
        public void onResults(Bundle results) {
            PluginCall c = listenCall;
            listenCall = null;
            ArrayList<String> m = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
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

    /**
     * The order engines are tried for a Persian voice: the phone's default, then Google's, then every other
     * installed one (eSpeak NG, a sherpa-onnx/Piper voice…) — the user only has to install one, not make it
     * the default.
     */
    static List<String> ttsOrder(String defaultEngine, List<String> installed) {
        List<String> out = new ArrayList<>();
        if (defaultEngine != null) out.add(defaultEngine);
        if (installed.contains(GOOGLE_TTS) && !out.contains(GOOGLE_TTS)) out.add(GOOGLE_TTS);
        for (String e : installed) if (!out.contains(e)) out.add(e);
        return out;
    }

    private void initTts(String engine) {
        TextToSpeech.OnInitListener onInit = status -> {
          try {
            if (tts == null) return;
            String current = engine != null ? engine : tts.getDefaultEngine();
            ttsTried.add(current);
            ttsInstalled = new ArrayList<>();
            for (TextToSpeech.EngineInfo e : tts.getEngines()) ttsInstalled.add(e.name);
            ttsFa = status == TextToSpeech.SUCCESS && tts.setLanguage(FA) >= TextToSpeech.LANG_AVAILABLE;
            ttsEngine = current;
            if (!ttsFa) {
                for (String next : ttsOrder(tts.getDefaultEngine(), ttsInstalled)) {
                    if (ttsTried.contains(next)) continue;
                    tts.shutdown();
                    initTts(next);
                    return;
                }
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
          } catch (Throwable t) {
            ttsFa = false;
          }
        };
        tts = engine == null ? new TextToSpeech(getContext(), onInit) : new TextToSpeech(getContext(), onInit, engine);
    }

    /** The phone's text-to-speech settings, to install or pick a Persian voice. */
    @PluginMethod
    public void ttsSettings(PluginCall call) {
        Intent i = new Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            getContext().startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
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
