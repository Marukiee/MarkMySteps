package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.annotation.NonNull;
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

    /**
     * One position, right now, without starting the tracking service.
     *
     * The app asks for this once at launch so the maps can show where you are
     * even when you are not tracking a trip. It never prompts: if the
     * permission isn't there it simply reports back that it isn't.
     */
    @PluginMethod
    public void currentPosition(PluginCall call) {
        if (!hasForegroundPermission()) {
            call.reject("Geen locatietoestemming");
            return;
        }
        LocationManager manager =
                (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            call.reject("Geen locatieprovider beschikbaar");
            return;
        }

        long timeoutMs = getContext().getMainLooper() == null ? 0 : 20_000L;
        final Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] done = new boolean[1];
        final Location[] best = new Location[1];
        final LocationListener[] holder = new LocationListener[1];

        // Anything recent enough to still describe where you are is already an
        // answer; the live request only has to improve on it.
        Location known = bestLastKnown(manager);
        if (known != null && System.currentTimeMillis() - known.getTime() < 2 * 60_000L) {
            call.resolve(toResult(known));
            return;
        }
        best[0] = known;

        final Runnable finish = () -> {
            if (done[0]) return;
            done[0] = true;
            if (holder[0] != null) {
                try {
                    manager.removeUpdates(holder[0]);
                } catch (SecurityException ignored) {
                }
            }
            if (best[0] != null) call.resolve(toResult(best[0]));
            else call.reject("Geen positie gevonden");
        };

        holder[0] = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                if (best[0] == null
                        || !best[0].hasAccuracy()
                        || (location.hasAccuracy() && location.getAccuracy() < best[0].getAccuracy())) {
                    best[0] = location;
                }
                if (location.hasAccuracy() && location.getAccuracy() <= 40f) finish.run();
            }

            @Override
            public void onProviderDisabled(@NonNull String provider) {
            }

            @Override
            public void onProviderEnabled(@NonNull String provider) {
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
            }
        };

        boolean any = false;
        for (String provider : new String[] {
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
        }) {
            if (!manager.getAllProviders().contains(provider)) continue;
            try {
                manager.requestLocationUpdates(provider, 0L, 0f, holder[0], Looper.getMainLooper());
                any = true;
            } catch (SecurityException e) {
                call.reject("Geen locatietoestemming");
                return;
            } catch (IllegalArgumentException ignored) {
            }
        }
        if (!any) {
            finish.run();
            return;
        }
        handler.postDelayed(finish, timeoutMs);
    }

    @Nullable
    private Location bestLastKnown(LocationManager manager) {
        Location best = null;
        for (String provider : new String[] {
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER,
        }) {
            try {
                if (!manager.getAllProviders().contains(provider)) continue;
                Location known = manager.getLastKnownLocation(provider);
                if (known == null) continue;
                if (best == null || known.getTime() > best.getTime()) best = known;
            } catch (SecurityException e) {
                return null;
            }
        }
        return best;
    }

    private static JSObject toResult(Location location) {
        JSObject result = new JSObject();
        result.put("latitude", location.getLatitude());
        result.put("longitude", location.getLongitude());
        if (location.hasAccuracy()) result.put("accuracy", location.getAccuracy());
        if (location.hasAltitude()) result.put("altitude", location.getAltitude());
        result.put("time", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());
        return result;
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
