package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
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
     * Start tracking. `intervalMs` becomes the provider's minTime — the knob
     * that actually duty-cycles the GNSS engine — and `distanceFilterM` its
     * minDistance.
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

        Long interval = call.getLong("intervalMs", 60_000L);
        Float distance = call.getFloat("distanceFilterM", 50f);
        Intent intent = new Intent(getContext(), MmsLocationService.class);
        // Unboxed explicitly: a boxed Long/Float would land in the Bundle as a
        // Serializable rather than a primitive extra.
        intent.putExtra(
                MmsLocationService.EXTRA_INTERVAL,
                interval == null ? 60_000L : interval.longValue());
        intent.putExtra(
                MmsLocationService.EXTRA_DISTANCE,
                distance == null ? 50f : distance.floatValue());
        intent.putExtra(MmsLocationService.EXTRA_TITLE, call.getString("title", "MarkMySteps"));
        intent.putExtra(
                MmsLocationService.EXTRA_MESSAGE,
                call.getString("message", "Route wordt bijgehouden"));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
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

    // --- Sink ---------------------------------------------------------------

    @Override
    public void onLocation(Location location) {
        JSObject data = new JSObject();
        data.put("latitude", location.getLatitude());
        data.put("longitude", location.getLongitude());
        if (location.hasAccuracy()) data.put("accuracy", (double) location.getAccuracy());
        if (location.hasAltitude()) data.put("altitude", location.getAltitude());
        data.put("time", location.getTime());
        notifyListeners("location", data);
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
