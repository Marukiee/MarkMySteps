package nl.markmaaktmedia.markmysteps;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before the bridge starts loading the web app.
        registerPlugin(PredictiveBackPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
