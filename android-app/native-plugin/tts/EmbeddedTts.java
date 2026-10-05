package ir.moradisadegh.marketboard;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsMatchaModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsZipVoiceModelConfig;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The app's own Persian voice — no phone engine needed, no network (CLAUDE.md rule 71). sherpa-onnx runs the
 * Piper fa_IR «ganji_adabi» voice (int8) that android-app/scripts/fetch-tts.mjs fetched and wire-native-plugin.mjs
 * put in the APK. Copied into the Android project only when the voice was fetched, and created by VoicePlugin by
 * name, so an APK built without it still compiles and simply uses the phone's own engine.
 *
 * Built to fail without taking the app down (the first APK with it closed on the user's phone, rule 72):
 *  - each sentence is made with plain generate(); the engine's streaming callback is not used — its JNI side
 *    looks up invoke([F)Integer, which a Java lambda does not have, and leaves the NoSuchMethodError pending;
 *  - the engine loads only when the assistant opens (warm), not at every app start;
 *  - every step is inside try/catch, on threads that never let an exception reach Android's crash handler;
 *  - native work is bracketed by TtsGuard, so a native crash turns the voice off at the next start.
 */
public class EmbeddedTts implements VoicePlugin.Speaker {
    private final Context ctx;
    private final ExecutorService maker = Executors.newSingleThreadExecutor();
    private final ExecutorService player = Executors.newSingleThreadExecutor();
    private final AtomicInteger turn = new AtomicInteger();
    private final AtomicBoolean started = new AtomicBoolean();
    private volatile OfflineTts tts;
    private volatile String error;
    private volatile AudioTrack track;

    public EmbeddedTts(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        if (!TtsFiles.shipped(this.ctx)) throw new IllegalStateException("no built-in voice in this APK");
        if (TtsGuard.off(this.ctx)) error = TtsGuard.why(this.ctx);
    }

    /** Load the engine in the background (once). */
    @Override
    public void warm() {
        if (error == null && !started.getAndSet(true)) maker.execute(safe(this::load));
    }

    private Runnable safe(Runnable r) {
        return () -> {
            try {
                r.run();
            } catch (Throwable t) {
                error = describe(t);
            }
        };
    }

    static String describe(Throwable t) {
        String m = t.getClass().getSimpleName() + (t.getMessage() != null ? ": " + t.getMessage() : "");
        return m.length() > 300 ? m.substring(0, 300) : m;
    }

    private void load() {
        try {
            File dir = TtsFiles.ensure(ctx);
            OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig(
                new File(dir, "model.onnx").getAbsolutePath(), "", new File(dir, "tokens.txt").getAbsolutePath(),
                new File(dir, "espeak-ng-data").getAbsolutePath(), "", 0.667f, 0.8f, 1.0f);
            OfflineTtsModelConfig model = new OfflineTtsModelConfig(vits, new OfflineTtsMatchaModelConfig(), new OfflineTtsKokoroModelConfig(),
                new OfflineTtsZipVoiceModelConfig(), new OfflineTtsKittenModelConfig(), new OfflineTtsPocketModelConfig(),
                new OfflineTtsSupertonicModelConfig(), Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 2)), false, "cpu");
            TtsGuard.enter(ctx, "load");
            tts = new OfflineTts(null, new OfflineTtsConfig(model, "", "", 1, 0.2f));
        } catch (Throwable t) { // UnsatisfiedLinkError on a 32-bit phone (only arm64 is shipped), a full disk…
            error = describe(t);
        } finally {
            TtsGuard.leave(ctx);
        }
    }

    @Override
    public boolean ok() {
        return error == null;
    }

    @Override
    public String error() {
        return error;
    }

    @Override
    public void speak(String text, VoicePlugin.SpeakDone done) {
        warm();
        int mine = turn.incrementAndGet();
        halt();
        List<String> parts = TtsText.sentences(text);
        maker.execute(() -> {
            try {
                run(mine, parts, done);
            } catch (Throwable t) {
                done.failed(describe(t));
            }
        });
    }

    @Override
    public void stop() {
        turn.incrementAndGet();
        halt();
    }

    @Override
    public void shutdown() {
        stop();
        maker.shutdownNow();
        player.shutdownNow();
    }

    private void halt() {
        AudioTrack t = track;
        if (t != null) {
            try {
                t.pause();
                t.flush();
            } catch (Throwable ignored) {
                // already released
            }
        }
    }

    private void run(int mine, List<String> parts, VoicePlugin.SpeakDone done) {
        if (turn.get() != mine || parts.isEmpty()) {
            done.finished(true);
            return;
        }
        OfflineTts engine = tts;
        if (engine == null) {
            done.failed(error != null ? error : "صدای داخلی آماده نیست");
            return;
        }
        AudioTrack t = null;
        try {
            int sr = engine.sampleRate();
            int min = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
            t = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(sr).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(Math.max(Math.max(min, 0), sr * 4 / 2))
                .build();
            track = t;
            t.play();
            final AudioTrack out = t;
            long frames = 0;
            List<Future<?>> writes = new ArrayList<>();
            // sentence i plays (player thread) while sentence i+1 is made (this thread)
            for (String s : parts) {
                if (turn.get() != mine) break;
                TtsGuard.enter(ctx, "speak");
                GeneratedAudio a;
                try {
                    a = engine.generate(s, 0, 1.0f);
                } finally {
                    TtsGuard.leave(ctx);
                }
                float[] pcm = a == null ? null : a.getSamples();
                if (pcm == null || pcm.length == 0 || turn.get() != mine) continue;
                frames += pcm.length;
                writes.add(player.submit(() -> {
                    if (turn.get() == mine) out.write(pcm, 0, pcm.length, AudioTrack.WRITE_BLOCKING);
                }));
            }
            for (Future<?> w : writes) w.get();
            if (turn.get() == mine && frames > 0) {
                float[] tail = new float[sr / 5]; // a breath of silence: the voice ends abruptly otherwise
                t.write(tail, 0, tail.length, AudioTrack.WRITE_BLOCKING);
                frames += tail.length;
                long until = System.currentTimeMillis() + frames * 1000 / sr + 2000;
                while (turn.get() == mine && t.getPlaybackHeadPosition() < frames && System.currentTimeMillis() < until) Thread.sleep(30);
            }
            done.finished(turn.get() != mine);
        } catch (Throwable e) {
            done.failed(describe(e));
        } finally {
            track = null;
            if (t != null) {
                try {
                    t.stop();
                } catch (Throwable ignored) {
                    // not playing
                }
                try {
                    t.release();
                } catch (Throwable ignored) {
                    // released
                }
            }
        }
    }
}
