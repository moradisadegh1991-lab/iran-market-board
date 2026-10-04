package ir.moradisadegh.marketboard;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The built-in voice ships in the APK's assets (assets/tts-fa: model, tokens, espeak-ng-data). The engine
 * reads files, so on first use they are copied to the app's own storage — once per voice version, marked by
 * VERSION, so an app update with a new voice copies again and an unchanged one never does.
 */
public final class TtsFiles {
    static final String ASSETS = "tts-fa";

    private TtsFiles() {}

    /** True when this APK carries the voice at all. */
    public static boolean shipped(Context ctx) {
        try (InputStream in = ctx.getAssets().open(ASSETS + "/VERSION")) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** The voice's directory in the app's storage, copied from the assets if missing or out of date. */
    public static File ensure(Context ctx) throws IOException {
        AssetManager am = ctx.getAssets();
        String want = read(am.open(ASSETS + "/VERSION"));
        File dir = new File(ctx.getFilesDir(), ASSETS);
        File stamp = new File(dir, "VERSION");
        if (stamp.isFile() && want.equals(read(new java.io.FileInputStream(stamp)))) return dir;
        delete(dir);
        copy(am, ASSETS, dir);
        try (OutputStream out = new FileOutputStream(stamp)) {
            out.write(want.getBytes(StandardCharsets.UTF_8)); // last: a half-done copy is redone next time
        }
        return dir;
    }

    private static void copy(AssetManager am, String path, File to) throws IOException {
        String[] kids = am.list(path);
        if (kids == null || kids.length == 0) {
            if (path.endsWith("/VERSION")) return;
            to.getParentFile().mkdirs();
            try (InputStream in = am.open(path); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[1 << 16];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            }
            return;
        }
        to.mkdirs();
        for (String k : kids) copy(am, path + "/" + k, new File(to, k));
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream i = in) {
            byte[] all = new byte[4096];
            int n = 0;
            for (int r; (r = i.read(all, n, all.length - n)) > 0; ) n += r;
            return new String(all, 0, n, StandardCharsets.UTF_8).trim();
        }
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        f.delete();
    }
}
