package ir.moradisadegh.marketboard;

import android.Manifest;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotter;
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotterResult;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Listens for «مالی من» (CLAUDE.md rule 75): a foreground service of type microphone (Android shows its notification
 * and the green microphone dot while it runs), 16 kHz audio → the silence gate (Wake.Gate) → sherpa-onnx's keyword
 * spotter, on the phone. No audio is kept or sent. On the name it opens the assistant (Wake.heard) and lets go of
 * the microphone so the assistant can listen; the page resumes it when the assistant closes (or it resumes by
 * itself after Wake.AUTO_RESUME_MS).
 *
 * Fails without taking the app down (rule 72): every step in try, the native load bracketed by TtsGuard, and
 * Android 14+'s refusal to start a microphone service from the background (a restart by the system) just stops it.
 */
public class WakeService extends Service {
    private volatile Thread worker;
    private volatile long pausedUntil;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : Wake.ACTION_START;
        try {
            CrashLog.install(this);
            // restarted by the system after the last run died inside the spotter: stays off (rule 72)
            TtsGuard.check(this, CrashLog.lastExitWasCrash(this));
            if (Wake.ACTION_STOP.equals(action)) {
                Wake.save(this, false, null);
                quit();
                return START_NOT_STICKY;
            }
            if (Wake.ACTION_PAUSE.equals(action)) pause(Wake.AUTO_RESUME_MS);
            else if (Wake.ACTION_RESUME.equals(action)) pausedUntil = 0;
            Wake.paused = pausedUntil > SystemClock.elapsedRealtime();
            if (Build.VERSION.SDK_INT >= 29) startForeground(Wake.NOTE_ID, Wake.listening(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(Wake.NOTE_ID, Wake.listening(this));
            if (!Wake.enabled(this) || TtsGuard.wakeOff(this)) {
                quit();
                return START_NOT_STICKY;
            }
            Wake.running = true;
            if (worker == null) {
                worker = new Thread(this::loop, "wake");
                worker.start();
            }
            return START_STICKY;
        } catch (Throwable t) {
            // e.g. a restart in the background on Android 14+: microphone services may only start from the app
            Wake.error = EmbeddedTts.describe(t);
            quit();
            return START_NOT_STICKY;
        }
    }

    private void pause(long ms) {
        pausedUntil = SystemClock.elapsedRealtime() + ms;
    }

    private void quit() {
        Wake.running = false;
        Thread w = worker;
        worker = null;
        if (w != null) w.interrupt();
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
            // not in the foreground
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        Wake.running = false;
        Thread w = worker;
        worker = null;
        if (w != null) w.interrupt();
        super.onDestroy();
    }

    private KeywordSpotter load(String sensitivity) throws Exception {
        File dir = new File(TtsFiles.ensure(this), Wake.KWS_DIR);
        File kw = new File(getFilesDir(), "wake-keywords.txt");
        try (FileOutputStream out = new FileOutputStream(kw)) {
            out.write(Wake.keywords(sensitivity).getBytes(StandardCharsets.UTF_8));
        }
        OnlineTransducerModelConfig t = new OnlineTransducerModelConfig();
        t.setEncoder(new File(dir, "encoder.int8.onnx").getAbsolutePath());
        t.setDecoder(new File(dir, "decoder.onnx").getAbsolutePath());
        t.setJoiner(new File(dir, "joiner.int8.onnx").getAbsolutePath());
        OnlineModelConfig m = new OnlineModelConfig();
        m.setTransducer(t);
        m.setTokens(new File(dir, "tokens.txt").getAbsolutePath());
        m.setNumThreads(1);
        m.setProvider("cpu");
        KeywordSpotterConfig c = new KeywordSpotterConfig();
        c.setFeatConfig(new FeatureConfig());
        c.setModelConfig(m);
        c.setKeywordsFile(kw.getAbsolutePath());
        c.setKeywordsThreshold(Wake.threshold(sensitivity));
        c.setKeywordsScore(Wake.boost(sensitivity));
        c.setMaxActivePaths(4);
        TtsGuard.enter(this, "wake");
        try {
            return new KeywordSpotter(null, c);
        } finally {
            TtsGuard.leave(this);
        }
    }

    private void loop() {
        KeywordSpotter spotter = null;
        OnlineStream stream = null;
        AudioRecord rec = null;
        try {
            String sensitivity = Wake.sensitivity(this);
            spotter = load(sensitivity);
            stream = spotter.createStream("");
            Wake.Gate gate = new Wake.Gate();
            short[] pcm = new short[1600]; // 100 ms
            boolean[] reset = new boolean[1];
            long lastHeard = 0;
            while (worker == Thread.currentThread()) {
                boolean hold = pausedUntil > SystemClock.elapsedRealtime() || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED;
                if (hold != Wake.paused) {
                    Wake.paused = hold;
                    refreshNote();
                }
                if (hold) {
                    // the assistant (or another app) needs the microphone: let go of it
                    if (rec != null) {
                        release(rec);
                        rec = null;
                    }
                    Thread.sleep(250);
                    continue;
                }
                if (rec == null) {
                    rec = open();
                    gate = new Wake.Gate();
                    spotter.reset(stream);
                }
                int n = rec.read(pcm, 0, pcm.length);
                if (n <= 0) {
                    Thread.sleep(100);
                    continue;
                }
                float[] chunk = new float[n];
                for (int k = 0; k < n; k++) chunk[k] = pcm[k] / 32768f;
                float[][] feed = gate.push(chunk, reset);
                if (feed == null) continue;
                if (reset[0]) spotter.reset(stream);
                for (float[] f : feed) stream.acceptWaveform(f, 16000);
                while (spotter.isReady(stream)) {
                    spotter.decode(stream);
                    KeywordSpotterResult r = spotter.getResult(stream);
                    if (r.getKeyword() == null || r.getKeyword().isEmpty()) continue;
                    spotter.reset(stream);
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastHeard < 4000) continue; // one «مالی من», one wake
                    lastHeard = now;
                    pause(Wake.AUTO_RESUME_MS);
                    release(rec);
                    rec = null;
                    Wake.heard(this);
                    break;
                }
            }
        } catch (InterruptedException ignored) {
            // stopped
        } catch (Throwable t) {
            Wake.error = EmbeddedTts.describe(t);
            quitFromWorker();
        } finally {
            if (rec != null) release(rec);
            try {
                if (stream != null) stream.release();
                if (spotter != null) spotter.release();
            } catch (Throwable ignored) {
                // released
            }
        }
    }

    private AudioRecord open() {
        int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord r = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 16000 * 2));
        if (r.getState() != AudioRecord.STATE_INITIALIZED) {
            r.release();
            throw new IllegalStateException("میکروفون باز نشد");
        }
        r.startRecording();
        return r;
    }

    private static void release(AudioRecord r) {
        try {
            r.stop();
        } catch (Throwable ignored) {
            // not recording
        }
        try {
            r.release();
        } catch (Throwable ignored) {
            // released
        }
    }

    private void refreshNote() {
        try {
            android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
            if (nm != null) nm.notify(Wake.NOTE_ID, Wake.listening(this));
        } catch (Throwable ignored) {
            // the notification stays as it was
        }
    }

    private void quitFromWorker() {
        worker = null;
        Wake.running = false;
        try {
            stopForeground(true);
            stopSelf();
        } catch (Throwable ignored) {
            // already stopping
        }
    }
}
