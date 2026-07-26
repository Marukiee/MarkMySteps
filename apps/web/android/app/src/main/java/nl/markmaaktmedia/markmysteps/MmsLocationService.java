package nl.markmaaktmedia.markmysteps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.hardware.TriggerEvent;
import android.hardware.TriggerEventListener;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.util.List;

/**
 * Battery-conscious route tracking on plain AOSP — no Google Play Services.
 *
 * Everything runs through {@link LocationManager}, whose `minTime` genuinely
 * duty-cycles the GNSS engine (the fused provider we used before was pinned to
 * PRIORITY_HIGH_ACCURACY at 1 s and simply filtered the callbacks, which kept
 * the radio hot). Three further savings on top of that:
 *
 *  1. `minDistance` suppresses fixes while you stand still.
 *  2. PASSIVE_PROVIDER piggybacks on fixes other apps already paid for.
 *  3. When nothing arrives for a few intervals we assume you've stopped, drop
 *     the location request entirely and arm TYPE_SIGNIFICANT_MOTION. A phone
 *     lying on a table then costs nothing at all until it moves again.
 */
public class MmsLocationService extends Service implements LocationListener {

    private static final String TAG = "MmsLocation";
    private static final String CHANNEL_ID = "mms_tracking";
    private static final int NOTIFICATION_ID = 8421;
    private static final String PREFS = "mms.tracking.service";

    /** Notification action: pause/resume without leaving the app. */
    static final String ACTION_TOGGLE = "nl.markmaaktmedia.markmysteps.TOGGLE_TRACKING";

    static final String EXTRA_INTERVAL = "intervalMs";
    static final String EXTRA_DISTANCE = "distanceM";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_MESSAGE = "message";

    /** Where fixes are delivered. Same process as the plugin, so a plain
     *  reference beats a broadcast round-trip. */
    interface Sink {
        void onLocation(Location location);

        void onStatus(String state, @Nullable String message);
    }

    @Nullable
    static volatile Sink sink;

    private LocationManager locationManager;
    @Nullable
    private SensorManager sensorManager;
    @Nullable
    private Sensor significantMotion;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private long intervalMs = 60_000L;
    private float minDistanceM = 50f;
    private String title = "MarkMySteps";
    private String message = "Route wordt bijgehouden";

    private long lastFixAt = 0L;
    private boolean updatesActive = false;
    private boolean waitingForMotion = false;
    /** Paused from the notification: the service stays alive (and keeps its
     *  settings) but asks the OS for nothing at all. */
    private boolean paused = false;

    private final TriggerEventListener motionListener = new TriggerEventListener() {
        @Override
        public void onTrigger(TriggerEvent event) {
            // One-shot sensor: it disarms itself, so just resume tracking.
            waitingForMotion = false;
            startUpdates();
            updateNotification();
        }
    };

    private final Runnable idleCheck = new Runnable() {
        @Override
        public void run() {
            maybeGoIdle();
            handler.postDelayed(this, Math.max(intervalMs, 60_000L));
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            significantMotion = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION);
        }
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_TOGGLE.equals(intent.getAction())) {
            restoreConfig();
            paused = !paused;
            if (paused) {
                stopUpdates();
                disarmMotion();
                notifyStatus("paused", null);
            } else {
                startUpdates();
            }
            startInForeground();
            return START_STICKY;
        }

        if (intent != null && intent.hasExtra(EXTRA_INTERVAL)) {
            intervalMs = intent.getLongExtra(EXTRA_INTERVAL, intervalMs);
            minDistanceM = intent.getFloatExtra(EXTRA_DISTANCE, minDistanceM);
            title = orDefault(intent.getStringExtra(EXTRA_TITLE), title);
            message = orDefault(intent.getStringExtra(EXTRA_MESSAGE), message);
            persistConfig();
        } else {
            // Restarted by the system after the process died — recover settings.
            restoreConfig();
        }

        paused = false;
        startInForeground();
        startUpdates();
        handler.removeCallbacks(idleCheck);
        handler.postDelayed(idleCheck, Math.max(intervalMs, 60_000L));
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(idleCheck);
        stopUpdates();
        disarmMotion();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- Location -----------------------------------------------------------

    private void startUpdates() {
        if (updatesActive || locationManager == null) return;
        List<String> providers = locationManager.getAllProviders();
        boolean any = false;
        // GPS is the one that matters; NETWORK is usually absent on a
        // de-Googled ROM; PASSIVE is free, so we always listen in.
        for (String provider : new String[] {
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER,
        }) {
            if (!providers.contains(provider)) continue;
            try {
                locationManager.requestLocationUpdates(
                        provider, intervalMs, minDistanceM, this, Looper.getMainLooper());
                any = true;
            } catch (SecurityException e) {
                notifyStatus("permission", "Locatietoestemming ontbreekt");
                return;
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "provider unavailable: " + provider);
            }
        }
        if (!any) {
            notifyStatus("error", "Geen locatieprovider beschikbaar");
            return;
        }
        updatesActive = true;
        lastFixAt = System.currentTimeMillis();
        notifyStatus("tracking", "Providers: " + activeProviders(providers));
        requestImmediateFix();
    }

    /**
     * A registration with minDistance > 0 delivers NOTHING until you have moved
     * that far — so without this there is no starting point at all, the map has
     * no "you are here" and the log stays empty. Emit the last known position
     * right away and ask for one fresh, unfiltered fix on top of it.
     */
    private void requestImmediateFix() {
        if (locationManager == null) return;
        try {
            Location best = null;
            for (String provider : new String[] {
                    LocationManager.GPS_PROVIDER,
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER,
            }) {
                if (!locationManager.getAllProviders().contains(provider)) continue;
                Location known = locationManager.getLastKnownLocation(provider);
                if (known == null) continue;
                if (best == null || known.getTime() > best.getTime()) best = known;
            }
            // Only if it's recent enough to still describe where you are.
            if (best != null && System.currentTimeMillis() - best.getTime() < 10 * 60_000L) {
                onLocationChanged(best);
            }

            if (!locationManager.getAllProviders().contains(LocationManager.GPS_PROVIDER)) return;
            // One unfiltered fix, then unregister itself.
            final LocationListener[] holder = new LocationListener[1];
            holder[0] = new LocationListener() {
                @Override
                public void onLocationChanged(@NonNull Location location) {
                    MmsLocationService.this.onLocationChanged(location);
                    try {
                        locationManager.removeUpdates(holder[0]);
                    } catch (SecurityException ignored) {
                    }
                }

                @Override
                public void onStatusChanged(String provider, int status, Bundle extras) {
                }
            };
            locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 0L, 0f, holder[0], Looper.getMainLooper());
            // Give up after a minute so a cold GPS doesn't stay wide open.
            handler.postDelayed(() -> {
                try {
                    locationManager.removeUpdates(holder[0]);
                } catch (SecurityException ignored) {
                }
            }, 60_000L);
        } catch (SecurityException e) {
            notifyStatus("permission", "Locatietoestemming ontbreekt");
        }
    }

    private String activeProviders(List<String> all) {
        StringBuilder out = new StringBuilder();
        for (String provider : all) {
            boolean enabled;
            try {
                enabled = locationManager != null && locationManager.isProviderEnabled(provider);
            } catch (Exception e) {
                enabled = false;
            }
            if (out.length() > 0) out.append(", ");
            out.append(provider).append(enabled ? "" : " (uit)");
        }
        return out.toString();
    }

    private void stopUpdates() {
        if (!updatesActive || locationManager == null) return;
        try {
            locationManager.removeUpdates(this);
        } catch (SecurityException ignored) {
        }
        updatesActive = false;
    }

    private long lastSinkDeliveredAt = 0L;
    @Nullable
    private Location lastDeliveredLocation = null;

    @Override
    public void onLocationChanged(@NonNull Location location) {
        long now = System.currentTimeMillis();
        lastFixAt = now;
        if (waitingForMotion) {
            waitingForMotion = false;
            updateNotification();
        }
        Sink current = sink;
        if (current != null) {
            float dist = lastDeliveredLocation != null ? location.distanceTo(lastDeliveredLocation) : 9999f;
            long minSinkInterval = Math.min(intervalMs / 2, 15_000L);
            if (lastDeliveredLocation == null || now - lastSinkDeliveredAt >= minSinkInterval || dist >= 30f) {
                lastSinkDeliveredAt = now;
                lastDeliveredLocation = location;
                current.onLocation(location);
            }
        }
    }

    @Override
    public void onProviderDisabled(@NonNull String provider) {
        if (LocationManager.GPS_PROVIDER.equals(provider)) {
            notifyStatus("error", "GPS staat uit");
        }
    }

    @Override
    public void onProviderEnabled(@NonNull String provider) {
        notifyStatus("tracking", null);
    }

    /** Required on API < 29 or the listener is never registered on some ROMs. */
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    // --- Stationary detection ----------------------------------------------

    /**
     * No fix for a few intervals means `minDistance` is filtering everything
     * out — you're standing still. Drop the request and let the motion sensor
     * wake us instead of polling GNSS for nothing.
     */
    private void maybeGoIdle() {
        if (paused || !updatesActive || waitingForMotion || significantMotion == null) return;
        long still = System.currentTimeMillis() - lastFixAt;
        if (still < Math.max(intervalMs * 3, 5 * 60_000L)) return;
        stopUpdates();
        if (armMotion()) {
            waitingForMotion = true;
            updateNotification();
            notifyStatus("idle", null);
        } else {
            startUpdates(); // no sensor after all — keep tracking normally
        }
    }

    private boolean armMotion() {
        if (sensorManager == null || significantMotion == null) return false;
        return sensorManager.requestTriggerSensor(motionListener, significantMotion);
    }

    private void disarmMotion() {
        if (sensorManager != null && significantMotion != null) {
            sensorManager.cancelTriggerSensor(motionListener, significantMotion);
        }
        waitingForMotion = false;
    }

    // --- Notification -------------------------------------------------------

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Route-tracking", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Toont dat je route wordt bijgehouden");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_IMMUTABLE);

        // Toggle button: pausing keeps the service (and its settings) alive, so
        // resuming is one tap rather than a trip back into the app.
        Intent toggle = new Intent(this, MmsLocationService.class).setAction(ACTION_TOGGLE);
        PendingIntent togglePending = PendingIntent.getService(
                this, 1, toggle, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        String text;
        if (paused) text = "Gepauzeerd";
        else if (waitingForMotion) text = "Gepauzeerd, wacht tot je beweegt";
        else text = message;

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_stat_track)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(pending)
                .addAction(0, paused ? "Hervatten" : "Pauzeren", togglePending)
                .build();
    }

    private void startInForeground() {
        ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                        : 0);
    }

    private void updateNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    // --- Helpers ------------------------------------------------------------

    private void notifyStatus(String state, @Nullable String detail) {
        Sink current = sink;
        if (current != null) current.onStatus(state, detail);
    }

    private void persistConfig() {
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putLong(EXTRA_INTERVAL, intervalMs)
                .putFloat(EXTRA_DISTANCE, minDistanceM)
                .putString(EXTRA_TITLE, title)
                .putString(EXTRA_MESSAGE, message)
                .apply();
    }

    private void restoreConfig() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        intervalMs = prefs.getLong(EXTRA_INTERVAL, intervalMs);
        minDistanceM = prefs.getFloat(EXTRA_DISTANCE, minDistanceM);
        title = orDefault(prefs.getString(EXTRA_TITLE, null), title);
        message = orDefault(prefs.getString(EXTRA_MESSAGE, null), message);
    }

    private static String orDefault(@Nullable String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
