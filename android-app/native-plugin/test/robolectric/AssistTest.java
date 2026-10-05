package ir.moradisadegh.marketboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Application;
import android.content.Intent;
import androidx.test.core.app.ApplicationProvider;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** The ways into the assistant with the app closed (rule 74): which intents mean «open the assistant», and the tile. */
@RunWith(RobolectricTestRunner.class)
public class AssistTest {

    @Test
    @Config(sdk = 34)
    public void assistGestureVoiceButtonTileAndShortcutOpenTheAssistant() {
        assertTrue(VoicePlugin.isAssist(new Intent(Intent.ACTION_ASSIST)));
        assertTrue(VoicePlugin.isAssist(new Intent(Intent.ACTION_VOICE_COMMAND)));
        assertTrue(VoicePlugin.isAssist(new Intent(VoicePlugin.ACTION_ASSIST)));
        assertFalse(VoicePlugin.isAssist(new Intent(Intent.ACTION_MAIN)));
        assertFalse(VoicePlugin.isAssist(new Intent()));
        assertFalse(VoicePlugin.isAssist(null));
        // taken once: a rotation or coming back to the app does not open it again
        Intent i = new Intent(Intent.ACTION_ASSIST);
        assertTrue(VoicePlugin.takeAssistFrom(i));
        assertEquals(Intent.ACTION_MAIN, i.getAction());
        assertFalse(VoicePlugin.takeAssistFrom(i));
    }

    @Test
    @Config(sdk = 33)
    public void theQuickSettingsTileOpensTheAppIntoTheAssistant() {
        Application app = ApplicationProvider.getApplicationContext();
        AssistTile tile = Robolectric.setupService(AssistTile.class);
        tile.onClick();
        Intent started = shadowOf(app).getNextStartedActivity();
        assertNotNull("the tile starts the app", started);
        assertEquals(VoicePlugin.ACTION_ASSIST, started.getAction());
        assertTrue((started.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) != 0);
    }
}
