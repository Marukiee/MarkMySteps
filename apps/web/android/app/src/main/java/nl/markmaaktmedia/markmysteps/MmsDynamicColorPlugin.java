package nl.markmaaktmedia.markmysteps;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The wallpaper-derived system palette ("Monet"), handed to the WebView.
 *
 * These are plain AOSP framework resources, present since Android 12 — no Play
 * Services and no Material Components dependency — so they are there on
 * LineageOS and GrapheneOS too. The palette is five tonal ramps of thirteen
 * steps; this plugin only reads them, and the web side decides which step
 * becomes which Material 3 role (see src/lib/dynamicColor.ts). Keeping the
 * mapping in TypeScript means the skin can be retuned without an APK rebuild.
 *
 * Below API 31 `available` comes back false and the web side falls back to a
 * palette generated from the app's own seed colour.
 */
@CapacitorPlugin(name = "MmsDynamicColor")
public class MmsDynamicColorPlugin extends Plugin {

    /** The thirteen tone steps every AOSP ramp is published at. */
    private static final int[] TONES = {
        0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
    };

    private static final String[] RAMPS = {
        "accent1", "accent2", "accent3", "neutral1", "neutral2"
    };

    @PluginMethod
    public void getPalette(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            result.put("available", false);
            call.resolve(result);
            return;
        }

        JSObject ramps = new JSObject();
        for (String ramp : RAMPS) {
            JSObject steps = new JSObject();
            for (int tone : TONES) {
                Integer color = lookup(ramp, tone);
                if (color != null) steps.put(String.valueOf(tone), hex(color));
            }
            ramps.put(ramp, steps);
        }

        result.put("available", true);
        result.put("ramps", ramps);
        call.resolve(result);
    }

    /**
     * Resolves e.g. `android:color/system_accent1_600` by name.
     *
     * By name rather than by `android.R.color.system_accent1_600` constant so
     * that compiling against an older platform SDK — or running on a build that
     * trimmed a ramp — degrades to a missing entry instead of failing.
     */
    private Integer lookup(String ramp, int tone) {
        String name = "system_" + ramp + "_" + tone;
        int id = getContext().getResources().getIdentifier(name, "color", "android");
        if (id == 0) return null;
        try {
            return getContext().getResources().getColor(id, getContext().getTheme());
        } catch (Exception e) {
            return null;
        }
    }

    private static String hex(int color) {
        return String.format("#%06X", 0xFFFFFF & color);
    }
}
