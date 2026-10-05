package ir.moradisadegh.marketboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Application;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import androidx.test.core.app.ApplicationProvider;
import java.util.Arrays;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowSettings;

/**
 * «مالی من» (rule 75) on the JVM: the measured sensitivities, the silence gate, what happens when the name is heard
 * (the assistant opens over the screen, or a notification when it may not), the listening notification, the crash
 * guard — and the service itself failing cleanly where its native spotter cannot load (as it cannot here).
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class WakeTest {
    private Application app;

    @Before
    public void setUp() {
        app = ApplicationProvider.getApplicationContext();
        Wake.p(app).edit().clear().commit();
        TtsGuard.reset(app);
        TtsGuard.wakeReset(app);
        Wake.running = false;
        Wake.paused = false;
        Wake.error = null;
    }

    @Test
    public void twoMeasuredSensitivitiesDefaultSensitive() {
        assertEquals("sensitive", Wake.sensitivity(app));
        assertEquals(5, Wake.keywords("sensitive").trim().split("\n").length);
        assertEquals("M AA1 L IY0 M AE1 N @MALI_MAN\n", Wake.keywords("careful"));
        assertEquals(0.2f, Wake.threshold("sensitive"), 1e-6);
        assertEquals(3.0f, Wake.boost("sensitive"), 1e-6);
        assertEquals(0.25f, Wake.threshold("careful"), 1e-6);
        assertEquals(1.0f, Wake.boost("careful"), 1e-6);
        Wake.save(app, true, "careful");
        assertTrue(Wake.enabled(app));
        assertEquals("careful", Wake.sensitivity(app));
        Wake.save(app, false, "anything else");
        assertFalse(Wake.enabled(app));
        assertEquals("sensitive", Wake.sensitivity(app));
    }

    private static float[] tone(float rms) {
        float[] x = new float[1600];
        for (int i = 0; i < x.length; i++) x[i] = (float) (rms * Math.sqrt(2) * Math.sin(i * 0.3));
        return x;
    }

    @Test
    public void gateSleepsInSilenceAndWakesWithTheHalfSecondBefore() {
        Wake.Gate g = new Wake.Gate();
        boolean[] reset = new boolean[1];
        for (int i = 0; i < 20; i++) assertNull("quiet room: the spotter rests", g.push(tone(0.0005f), reset));
        float[] speech = tone(0.05f);
        float[][] out = g.push(speech, reset);
        assertNotNull(out);
        assertTrue("a new utterance: the stream starts fresh", reset[0]);
        assertEquals("five chunks before it (0.5 s), then it", 6, out.length);
        assertTrue(out[5] == speech);
        // between words it keeps listening for 1.2 s, then rests again
        for (int i = 0; i < Wake.Gate.HANGOVER; i++) {
            float[][] o = g.push(tone(0.0005f), reset);
            assertNotNull(o);
            assertFalse(reset[0]);
        }
        assertNull(g.push(tone(0.0005f), reset));
        assertFalse(g.active());
    }

    @Test
    public void gateLearnsAFanAndStillHearsSpeechOverIt() {
        Wake.Gate g = new Wake.Gate();
        boolean[] reset = new boolean[1];
        for (int i = 0; i < 600; i++) g.push(tone(0.01f), reset); // a minute of steady noise louder than the gate
        assertNull("the room's own noise does not keep the spotter running", g.push(tone(0.01f), reset));
        assertNotNull("speech three times the noise opens it", g.push(tone(0.05f), reset));
    }

    @Test
    public void heardOpensTheAssistantOverTheScreenWhenAllowed() {
        ShadowSettings.setCanDrawOverlays(true);
        assertEquals("opened", Wake.heard(app));
        Intent started = shadowOf(app).getNextStartedActivity();
        assertNotNull(started);
        assertEquals(VoicePlugin.ACTION_ASSIST, started.getAction());
        assertTrue(started.getBooleanExtra(Wake.EXTRA_WAKE, false));
        assertTrue((started.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) != 0);
        assertTrue(VoicePlugin.isAssist(started));
    }

    @Test
    public void heardWithoutPermissionAsksWithANotification() {
        ShadowSettings.setCanDrawOverlays(false);
        assertEquals("notified", Wake.heard(app));
        assertNull("no activity from the background without the permission", shadowOf(app).getNextStartedActivity());
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, nm.getNotificationChannel(Wake.CHANNEL_HEARD).getImportance());
        Notification n = shadowOf(nm).getNotification(Wake.HEARD_ID);
        assertNotNull(n);
        assertEquals(Wake.CHANNEL_HEARD, n.getChannelId());
        assertEquals("«مالی من» را شنیدم", n.extras.getString(Notification.EXTRA_TITLE));
        Intent tap = shadowOf(n.contentIntent).getSavedIntent();
        assertEquals(VoicePlugin.ACTION_ASSIST, tap.getAction());
        assertTrue(tap.getBooleanExtra(Wake.EXTRA_WAKE, false));
    }

    @Test
    public void listeningNotificationIsQuietOngoingAndCanBeTurnedOff() {
        Notification n = Wake.listening(app);
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        assertEquals("channel made before use (rule 14)", NotificationManager.IMPORTANCE_MIN, nm.getNotificationChannel(Wake.CHANNEL).getImportance());
        assertEquals(Wake.CHANNEL, n.getChannelId());
        assertTrue((n.flags & Notification.FLAG_ONGOING_EVENT) != 0);
        assertEquals("در انتظار «مالی من»", n.extras.getString(Notification.EXTRA_TITLE));
        if (Wake.serviceClass() != null) {
            assertEquals(1, n.actions.length);
            assertEquals("خاموش", n.actions[0].title.toString());
            assertEquals(Wake.ACTION_STOP, shadowOf(n.actions[0].actionIntent).getSavedIntent().getAction());
        }
    }

    @Test
    public void aCrashInsideTheListenerTurnsOnlyTheListenerOff() {
        TtsGuard.enter(app, "wake");
        // the same run: still loading, not a crash
        TtsGuard.check(app, true);
        assertFalse(TtsGuard.wakeOff(app));
        // the next run (another process) finds it and Android says the last run crashed
        app.getSharedPreferences(TtsGuard.PREFS, 0).edit().putInt("pid", -42).commit();
        TtsGuard.check(app, true);
        assertTrue(TtsGuard.wakeOff(app));
        assertFalse("the voice is not to blame", TtsGuard.off(app));
        TtsGuard.reset(app); // «امتحان دوباره صدای داخلی» does not turn the listener back on by itself
        assertTrue(TtsGuard.wakeOff(app));
        TtsGuard.wakeReset(app);
        assertFalse(TtsGuard.wakeOff(app));
        // swiped away while loading (not a crash): stays on
        TtsGuard.enter(app, "wake");
        app.getSharedPreferences(TtsGuard.PREFS, 0).edit().putInt("pid", -42).commit();
        TtsGuard.check(app, false);
        assertFalse(TtsGuard.wakeOff(app));
    }

    @Test
    @SuppressWarnings("unchecked")
    public void theServiceFailsCleanlyWhereItsSpotterCannotLoad() throws Exception {
        Class<?> c = Wake.serviceClass();
        assumeTrue("only in a build with the built-in voice", c != null);
        Wake.save(app, true, "sensitive");
        Service s = Robolectric.buildService((Class<? extends Service>) c, new Intent(app, c).setAction(Wake.ACTION_START)).create().get();
        s.onStartCommand(new Intent(app, c).setAction(Wake.ACTION_START), 0, 1);
        assertNotNull("in the foreground, with its notification", shadowOf(s).getLastForegroundNotification());
        // the native spotter is arm64-only: on this JVM it fails to load — the service stops, the app does not
        long until = System.currentTimeMillis() + 60_000;
        while (Wake.running && System.currentTimeMillis() < until) Thread.sleep(50);
        assertFalse(Wake.running);
        assertNotNull(Wake.error);
        assertFalse("a clean failure is not a crash: still allowed next time", TtsGuard.wakeOff(app));
        // turned off from its notification
        s.onStartCommand(new Intent(app, c).setAction(Wake.ACTION_STOP), 0, 2);
        assertFalse(Wake.enabled(app));
        assertTrue(Arrays.asList("sensitive", "careful").contains(Wake.sensitivity(app)));
    }
}
