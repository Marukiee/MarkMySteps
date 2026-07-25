package nl.markmaaktmedia.markmysteps;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges Android's Predictive Back Gesture into the WebView.
 *
 * The system reports the gesture as it happens (start → progress → commit or
 * cancel); we forward those events to JS so the page can shrink away under the
 * user's finger and reveal what's behind it, exactly like a native screen.
 *
 * On API < 34 only `backInvoked` fires (there is no progress phase), so the
 * navigation still works — just without the live preview.
 *
 * When the app is at the root of its history JS calls {@link #setEnabled} with
 * false: the callback steps aside and the system runs its own "close the app"
 * animation instead.
 */
@CapacitorPlugin(name = "PredictiveBack")
public class PredictiveBackPlugin extends Plugin {

    private OnBackPressedCallback callback;

    @Override
    public void load() {
        callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackStarted(@NonNull BackEventCompat event) {
                notifyListeners("backStarted", progressData(event));
            }

            @Override
            public void handleOnBackProgressed(@NonNull BackEventCompat event) {
                notifyListeners("backProgressed", progressData(event));
            }

            @Override
            public void handleOnBackCancelled() {
                notifyListeners("backCancelled", new JSObject());
            }

            @Override
            public void handleOnBackPressed() {
                notifyListeners("backInvoked", new JSObject());
            }
        };
        // Added after Capacitor's own handling, so this callback wins.
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), callback);
    }

    private JSObject progressData(BackEventCompat event) {
        JSObject data = new JSObject();
        data.put("progress", event.getProgress());
        data.put("edge", event.getSwipeEdge() == BackEventCompat.EDGE_RIGHT ? "right" : "left");
        return data;
    }

    /** Hand back control to the system (used at the root, so back closes the app). */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", true);
        getActivity().runOnUiThread(() -> callback.setEnabled(enabled));
        call.resolve();
    }
}
