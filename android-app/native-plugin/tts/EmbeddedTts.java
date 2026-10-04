package ir.moradisadegh.marketboard;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The app's own Persian voice — no phone engine needed, no network (CLAUDE.md rule 71). sherpa-onnx runs the
 * Piper fa_IR «ganji_adabi» voice (int8) that android-app/scripts/fetch-tts.mjs fetched and wire-native-plugin.mjs
 * put in the APK; the sound streams to an AudioTrack sentence by sentence while the rest is still being made.
 * Copied into the Android project only when the voice was fetched, and created by VoicePlugin by name, so an APK
 * built without it still compiles and simply uses the phone's own engine.
 */
public class EmbeddedTts implements VoicePlugin.Speaker {
    private final Context ctx;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger turn = new AtomicInteger();
    private volatile OfflineTts tts;
    private volatile String error;
    private volatile AudioTrack track;

    public EmbeddedTts(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        if (!TtsFiles.shipped(this.ctx)) throw new IllegalStateException("no built-in voice in this APK");
        worker.execute(this::load); // copy + load in the background, so the first answer is not kept waiting
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
            tts = new OfflineTts(null, new OfflineTtsConfig(model, "", "", 1, 0.2f));
        } catch (Throwable t) { // UnsatisfiedLinkError on a 32-bit phone (only arm64 is shipped), a full disk…
            error = t.getClass().getSimpleName() + ": " + t.getMessage();
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
        int mine = turn.incrementAndGet();
        halt();
        worker.execute(() -> run(mine, TtsText.prepare(text), done));
    }

    @Override
    public void stop() {
        turn.incrementAndGet();
        halt();
    }

    @Override
    public void shutdown() {
        stop();
        worker.shutdownNow();
    }

    private void halt() {
        AudioTrack t = track;
        if (t != null) {
            try {
                t.pause();
                t.flush();
            } catch (IllegalStateException ignored) {
                // already released
            }
        }
    }

    private void run(int mine, String text, VoicePlugin.SpeakDone done) {
        if (turn.get() != mine || text.isEmpty()) {
            done.finished(true);
            return;
        }
        OfflineTts engine = tts;
        if (engine == null) {
            done.failed(error != null ? error : "صدای داخلی آماده نیست");
            return;
        }
        int sr = engine.sampleRate();
        int min = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
        AudioTrack t = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(sr).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(Math.max(min, sr * 4 / 2))
            .build();
        track = t;
        long[] frames = { 0 };
        try {
            t.play();
            // each sentence is played as soon as it is made; returning 0 stops the engine when a newer answer came
            engine.generateWithCallback(text, 0, 1.0f, samples -> {
                if (turn.get() != mine) return 0;
                t.write(samples, 0, samples.length, AudioTrack.WRITE_BLOCKING);
                frames[0] += samples.length;
                return 1;
            });
            if (turn.get() == mine) {
                float[] tail = new float[sr / 5]; // a breath of silence: the voice ends abruptly otherwise
                t.write(tail, 0, tail.length, AudioTrack.WRITE_BLOCKING);
                frames[0] += tail.length;
                long until = System.currentTimeMillis() + frames[0] * 1000 / sr + 2000;
                while (turn.get() == mine && t.getPlaybackHeadPosition() < frames[0] && System.currentTimeMillis() < until) Thread.sleep(30);
            }
            done.finished(turn.get() != mine);
        } catch (Throwable e) {
            done.failed(e.getClass().getSimpleName() + ": " + e.getMessage());
        } finally {
            track = null;
            try {
                t.stop();
            } catch (IllegalStateException ignored) {
                // not playing
            }
            t.release();
        }
    }

}
