package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Capacitor front end for {@link MmsLocationService}.
 *
 * Deliberately GMS-free: no play-services-location dependency, so it works on
 * LineageOS / GrapheneOS without microG.
 */
@CapacitorPlugin(
        name = "MmsLocation",
        permissions = {
                @Permission(
                        alias = MmsLocationPlugin.FOREGROUND,
                        strings = {
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                        }),
                // Android 11+ insists this is asked for on its own, after the
                // foreground permission has already been granted.
                @Permission(
                        alias = MmsLocationPlugin.BACKGROUND,
                        strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
                @Permission(
                        alias = MmsLocationPlugin.NOTIFICATIONS,
                        strings = { Manifest.permission.POST_NOTIFICATIONS }),
        })
public class MmsLocationPlugin extends Plugin implements MmsLocationService.Sink {

    static final String FOREGROUND = "location";
    static final String BACKGROUND = "backgroundLocation";
    static final String NOTIFICATIONS = "notifications";

    @Override
    public void load() {
        MmsLocationService.sink = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (MmsLocationService.sink == this) MmsLocationService.sink = null;
        super.handleOnDestroy();
    }

    /**
     * Start tracking. `intervalMs` is how often the service wakes up for one
     * single position; the GNSS engine is off in between.
     */
    @PluginMethod
    public void start(PluginCall call) {
        // requestPermissionForAlias parks the call for us until the prompt is
        // answered, so no manual keep-alive bookkeeping is needed.
        if (!hasForegroundPermission()) {
            requestPermissionForAlias(FOREGROUND, call, "afterForeground");
            return;
        }
        continueAfterForeground(call);
    }

    @PermissionCallback
    private void afterForeground(PluginCall call) {
        if (!hasForegroundPermission()) {
            call.reject("Locatietoestemming geweigerd");
            return;
        }
        continueAfterForeground(call);
    }

    private void continueAfterForeground(PluginCall call) {
        // Background location is a separate, second prompt (Android 10+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState(BACKGROUND) != PermissionState.GRANTED) {
            requestPermissionForAlias(BACKGROUND, call, "afterBackground");
            return;
        }
        requestNotificationsThenStart(call);
    }

    @PermissionCallback
    private void afterBackground(PluginCall call) {
        // Refusing "allow all the time" only costs us screen-off accuracy —
        // tracking still runs while the app is open, so we continue either way.
        requestNotificationsThenStart(call);
    }

    private void requestNotificationsThenStart(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "afterNotifications");
            return;
        }
        launchService(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        // The foreground-service notification is mandatory for the OS but the
        // user may still hide it; starting is fine either way.
        launchService(call);
    }

    private void launchService(PluginCall call) {
        // `startService: false` runs the permission chain only — the onboarding
        // uses that to ask for location without switching tracking on.
        if (Boolean.FALSE.equals(call.getBoolean("startService", true))) {
            JSObject result = new JSObject();
            result.put("granted", hasForegroundPermission());
            result.put("background", getPermissionState(BACKGROUND) == PermissionState.GRANTED);
            call.resolve(result);
            return;
        }

        // NOT call.getLong: Capacitor's implementation returns the default
        // unless the JSON value is literally a java.lang.Long, and a JS number
        // arrives as an Integer — so every interval silently became 5 minutes.
        // JSONObject.optLong coerces Integer/Double/String properly.
        long interval = call.getData().optLong("intervalMs", 300_000L);
        Intent intent = new Intent(getContext(), MmsLocationService.class);
        // Unboxed explicitly: a boxed Long would land in the Bundle as a
        // Serializable rather than a primitive extra.
        intent.putExtra(MmsLocationService.EXTRA_INTERVAL, interval);
        intent.putExtra(MmsLocationService.EXTRA_TITLE, call.getString("title", "MarkMySteps"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException — surface it rather
            // than silently resolving and never producing a fix.
            call.reject("Tracking-service kon niet starten: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    /**
     * Asks for exactly ONE permission and nothing else.
     *
     * The onboarding has a slide per permission, so chaining them (as start()
     * does) fired every system dialog the moment you tapped the first button.
     * `type` is "location", "background" or "notifications".
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        String type = call.getString("type", "location");
        if ("background".equals(type)) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    || getPermissionState(BACKGROUND) == PermissionState.GRANTED) {
                resolvePermissions(call);
                return;
            }
            // Android 11+ only shows this dialog once the foreground permission
            // is already granted; without it the request is denied instantly.
            if (!hasForegroundPermission()) {
                call.reject("Vraag eerst de gewone locatietoestemming");
                return;
            }
            requestPermissionForAlias(BACKGROUND, call, "afterSingle");
            return;
        }
        if ("notifications".equals(type)) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                    || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
                resolvePermissions(call);
                return;
            }
            requestPermissionForAlias(NOTIFICATIONS, call, "afterSingle");
            return;
        }
        if (hasForegroundPermission()) {
            resolvePermissions(call);
            return;
        }
        requestPermissionForAlias(FOREGROUND, call, "afterSingle");
    }

    @PermissionCallback
    private void afterSingle(PluginCall call) {
        resolvePermissions(call);
    }

    /** Current state of all three permissions, in one object. */
    @PluginMethod
    public void permissionStatus(PluginCall call) {
        resolvePermissions(call);
    }

    private void resolvePermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("location", hasForegroundPermission());
        result.put(
                "background",
                Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                        || getPermissionState(BACKGROUND) == PermissionState.GRANTED);
        result.put(
                "notifications",
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                        || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED);
        call.resolve(result);
    }

    /** Whether "allow all the time" is actually granted, so the UI doesn't have
     *  to nag about a setting that's already correct. */
    @PluginMethod
    public void backgroundStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || getPermissionState(BACKGROUND) == PermissionState.GRANTED;
        result.put("granted", granted);
        result.put("foreground", hasForegroundPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MmsLocationService.class));
        call.resolve();
    }

    /** Opens this app's system settings, for flipping location to "Always". */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /**
     * Hands over every fix the service queued since the last call and clears
     * the queue. Pulling rather than pushing is what makes tracking survive a
     * destroyed WebView: the service keeps queueing while no page is alive, and
     * the app collects the backlog the moment it comes back.
     */
    @PluginMethod
    public void drain(PluginCall call) {
        JSObject result = new JSObject();
        result.put("fixes", MmsLocationService.drainQueue(getContext()));
        call.resolve(result);
    }

    // --- Sink ---------------------------------------------------------------

    @Override
    public void onLocation() {
        // Only a nudge — the fix itself is picked up with drain().
        notifyListeners("location", new JSObject());
    }

    @Override
    public void onStatus(String state, @Nullable String message) {
        JSObject data = new JSObject();
        data.put("state", state);
        data.put("message", message);
        notifyListeners("status", data);
    }

    // --- Helpers ------------------------------------------------------------

    private boolean hasForegroundPermission() {
        return ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

}
