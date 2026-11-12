package nl.markmaaktmedia.markmysteps;

import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * How much of the status bar and the gesture bar lies over the page.
 *
 * The page runs up under the status bar on purpose, for the globe and the map,
 * and leans on env(safe-area-inset-*) to keep text clear of it. Which WebView
 * the phone has decides whether those are filled in: on some phones the page
 * is under the bar while the WebView reports nothing, and the logo ended up
 * behind the camera. This measures the overlap itself, from where the WebView
 * actually sits against the system bars, so it is right on every phone: zero
 * when Android has already moved the page out of the way.
 */
@CapacitorPlugin(name = "MmsInsets")
public class MmsInsetsPlugin extends Plugin {
    private double lastTop = -1;
    private double lastBottom = -1;

    @Override
    public void load() {
        View web = getBridge().getWebView();
        // Turning the phone, the keyboard and the bars changing all move or
        // resize the WebView, so this is where a new overlap shows up.
        web.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> report());
        ViewCompat.requestApplyInsets(web);
    }

    @PluginMethod
    public void get(PluginCall call) {
        call.resolve(measure());
    }

    private void report() {
        JSObject now = measure();
        double top = now.optDouble("top", 0);
        double bottom = now.optDouble("bottom", 0);
        if (top == lastTop && bottom == lastBottom) return;
        lastTop = top;
        lastBottom = bottom;
        notifyListeners("change", now);
    }

    private JSObject measure() {
        JSObject out = new JSObject();
        out.put("top", 0);
        out.put("bottom", 0);
        View web = getBridge().getWebView();
        WindowInsetsCompat insets = web == null ? null : ViewCompat.getRootWindowInsets(web);
        if (insets == null) return out;

        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        int[] at = new int[2];
        web.getLocationInWindow(at);
        int windowHeight = web.getRootView().getHeight();
        int top = Math.max(0, bars.top - at[1]);
        int bottom = Math.max(0, at[1] + web.getHeight() - (windowHeight - bars.bottom));

        float density = getContext().getResources().getDisplayMetrics().density;
        out.put("top", Math.round(top / density * 10) / 10.0);
        out.put("bottom", Math.round(bottom / density * 10) / 10.0);
        return out;
    }
}
