package nl.markmaaktmedia.markmysteps;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * Where a tapped notification wants the app to go.
     *
     * Kept here rather than pushed into the WebView, because a notification can
     * start the activity before the web app exists. The app asks for it (and
     * clears it) once it is running — see MmsNotifyPlugin.takePendingPath.
     */
    private static String pendingPath = null;

    static String takePendingPath() {
        String path = pendingPath;
        pendingPath = null;
        return path;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before the bridge starts loading the web app.
        registerPlugin(PredictiveBackPlugin.class);
        registerPlugin(MmsLocationPlugin.class);
        registerPlugin(MmsHapticsPlugin.class);
        registerPlugin(MmsGalleryPlugin.class);
        registerPlugin(MmsExportPlugin.class);
        registerPlugin(MmsNotifyPlugin.class);
        super.onCreate(savedInstanceState);
        remember(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        remember(intent);
    }

    private void remember(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra("mmsPath");
        if (path != null && path.startsWith("/")) pendingPath = path;
    }
}
