package nl.markmaaktmedia.markmysteps;

import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * System haptics for gestures.
 *
 * The web Vibration API is gated on user activation, which a `touchmove` does
 * not grant — so a tick fired part-way through a swipe simply didn't happen,
 * and only worked once something had been tapped earlier. Going through the
 * view's own haptic feedback fixes that, and it also respects the phone's
 * "touch feedback" setting and its intensity, which navigator.vibrate ignores.
 */
@CapacitorPlugin(name = "MmsHaptics")
public class MmsHapticsPlugin extends Plugin {

    /**
     * `style` picks the gesture constant:
     *   threshold-on  — a drag has crossed into the commit zone
     *   threshold-off — and back out of it again
     *   end           — the gesture committed
     *   light         — a plain tick (a row coming loose, an item picked up)
     */
    @PluginMethod
    public void impact(PluginCall call) {
        String style = call.getString("style", "light");
        View view = getBridge().getWebView();
        if (view == null) {
            call.resolve();
            return;
        }
        view.performHapticFeedback(constantFor(style), HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
        call.resolve();
    }

    private static int constantFor(String style) {
        if (style == null) return HapticFeedbackConstants.CLOCK_TICK;
        switch (style) {
            case "threshold-on":
                // Added in Android 14; older versions get the nearest thing.
                if (Build.VERSION.SDK_INT >= 34) return HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE;
                return HapticFeedbackConstants.CLOCK_TICK;
            case "threshold-off":
                if (Build.VERSION.SDK_INT >= 34) return HapticFeedbackConstants.GESTURE_THRESHOLD_DEACTIVATE;
                return HapticFeedbackConstants.CLOCK_TICK;
            case "end":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return HapticFeedbackConstants.GESTURE_END;
                return HapticFeedbackConstants.CONTEXT_CLICK;
            case "long-press":
                return HapticFeedbackConstants.LONG_PRESS;
            default:
                return HapticFeedbackConstants.CLOCK_TICK;
        }
    }
}
