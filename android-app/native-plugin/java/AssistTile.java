package ir.moradisadegh.marketboard;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.TileService;

/**
 * «دستیار مالی من» in the phone's quick settings (pull down from the top, from anywhere, the app closed or not):
 * one tap opens the app straight into the assistant, already listening (VoicePlugin.isAssist, rule 74).
 */
public class AssistTile extends TileService {

    static Intent assistIntent(android.content.Context ctx) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent();
        return i.setAction(VoicePlugin.ACTION_ASSIST).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    @Override
    public void onClick() {
        try {
            if (isLocked()) unlockAndRun(this::open);
            else open();
        } catch (Throwable ignored) {
            // a tile never takes the phone's quick settings down with it
        }
    }

    private void open() {
        Intent i = assistIntent(this);
        if (Build.VERSION.SDK_INT >= 34) {
            // Android 14+: only the PendingIntent form may start an activity from a tile
            startActivityAndCollapse(PendingIntent.getActivity(this, 74, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            startActivityAndCollapse(i);
        }
    }
}
