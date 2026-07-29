package nl.markmaaktmedia.markmysteps;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * Battery-conscious route tracking on plain AOSP — no Google Play Services.
 *
 * One fix per interval, nothing in between. An alarm wakes the service, the
 * service turns the GNSS engine on just long enough for a single position,
 * hands that one position to the app and switches the radio off again. There is
 * no continuous location request, so between two ticks the tracker costs
 * nothing at all — and the log gets exactly one line per interval.
 *
 * Two schedulers run in parallel because neither alone is reliable: a Handler
 * (precise while the CPU is awake) and an AlarmManager alarm (survives Doze).
 * Whichever fires first performs the tick and re-arms both.
 *
 * Fixes are queued in SharedPreferences before they are announced. The
 * WebView can be torn down while the foreground service keeps running, and a
 * fix that was only delivered as an event would then be lost; the queue is
 * drained by the plugin instead, so every fix is handed over exactly once.
 */
public class MmsLocationService extends Service {

    private static final String TAG = "MmsLocation";
    private static final String CHANNEL_ID = "mms_tracking";
    private static final int NOTIFICATION_ID = 8421;
    private static final String PREFS = "mms.tracking.service";
    private static final String KEY_PENDING = "pendingFixes";

    /** Notification action: pause/resume without leaving the app. */
    static final String ACTION_TOGGLE = "nl.markmaaktmedia.markmysteps.TOGGLE_TRACKING";
    /** Scheduler action: time for the next single fix. */
    static final String ACTION_TICK = "nl.markmaaktmedia.markmysteps.TICK";

    static final String EXTRA_INTERVAL = "intervalMs";
    static final String EXTRA_TITLE = "title";

    /** Good enough to stop waiting for a better fix. */
    private static final float GOOD_ACCURACY_M = 25f;
    /** Never keep the GNSS engine on longer than this per tick. */
    private static final long MAX_FIX_WAIT_MS = 45_000L;
    private static final long MIN_FIX_WAIT_MS = 20_000L;
    /** Cap on unread fixes kept for the app; ~4 days at 5 minutes. */
    private static final int MAX_PENDING = 1200;

    /**
     * Moved at least this far since the previous fix → you are travelling, and
     * the next check comes sooner. One point every 5 minutes at 100 km/h is a
     * point every 8 km, which draws the motorway as one long straight line; this
     * is what puts the corners back in without costing anything while you sit
     * still.
     */
    private static final float MOVING_M = 250f;
    /** Floor for the shortened interval while travelling. */
    private static final long MIN_MOVING_INTERVAL_MS = 60_000L;

    /**
     * Fixes other apps request are handed to us for free on the passive
     * provider — the GNSS engine is already on, so listening costs no extra
     * battery at all. They fill the gaps between our own scheduled checks.
     */
    private static final long PASSIVE_MIN_TIME_MS = 30_000L;
    private static final float PASSIVE_MIN_DISTANCE_M = 100f;

    /** Where fixes are announced. Same process as the plugin, so a plain
     *  reference beats a broadcast round-trip. The queue is the source of
     *  truth; this only tells the app that there is something to drain. */
    interface Sink {
        void onLocation();

        void onStatus(String state, @Nullable String message);
    }

    @Nullable
    static volatile Sink sink;

    private LocationManager locationManager;
    @Nullable
    private AlarmManager alarmManager;
    @Nullable
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private long intervalMs = 5 * 60_000L;
    private String title = "MarkMySteps";

    /** Paused from the notification: the service stays alive (and keeps its
     *  settings) but asks the OS for nothing at all. */
    private boolean paused = false;
    private boolean fixInFlight = false;
    private long lastFixAt = 0L;
    @Nullable
    private Location lastFix = null;
    private long nextTickAt = 0L;
    /** True while the last two fixes were far enough apart to be travel. */
    private boolean moving = false;
    /** Permanent, free listener on the passive provider (see PASSIVE_MIN_*). */
    @Nullable
    private LocationListener passiveListener = null;

    private final Runnable tickRunnable = this::runTick;

    // --- Lifecycle ----------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_TICK.equals(action)) {
            restoreConfig();
            startInForeground();
            runTick();
            return START_STICKY;
        }

        if (ACTION_TOGGLE.equals(action)) {
            restoreConfig();
            paused = !paused;
            if (paused) {
                cancelSchedule();
                abortFix();
                stopPassive();
                notifyStatus("paused", null);
                startInForeground();
            } else {
                startInForeground();
                startPassive();
                runTick();
            }
            return START_STICKY;
        }

        if (intent != null && intent.hasExtra(EXTRA_INTERVAL)) {
            intervalMs = Math.max(60_000L, intent.getLongExtra(EXTRA_INTERVAL, intervalMs));
            title = orDefault(intent.getStringExtra(EXTRA_TITLE), title);
            persistConfig();
        } else {
            // Restarted by the system after the process died — recover settings.
            restoreConfig();
        }

        paused = false;
        startInForeground();
        startPassive();
        // Reopening the app is not a check: if the last one is still recent,
        // keep the existing cadence instead of forcing an extra fix.
        if (lastFixAt > 0 && System.currentTimeMillis() - lastFixAt < currentIntervalMs()) {
            scheduleAt(lastFixAt + currentIntervalMs());
        } else {
            runTick();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        cancelSchedule();
        abortFix();
        stopPassive();
        releaseWakeLock();
        // The queue is deliberately NOT cleared. The app stops and restarts this
        // service on every launch (and whenever the interval changes); wiping the
        // prefs here threw away every fix recorded while the app was closed,
        // which is exactly the backlog that has to survive.
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .remove(EXTRA_INTERVAL)
                .remove(EXTRA_TITLE)
                .apply();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- One fix per interval -----------------------------------------------

    private void runTick() {
        cancelSchedule();
        if (paused) return;
        if (fixInFlight) return; // both schedulers fired — one tick is enough
        fixInFlight = true;
        acquireWakeLock();
        requestSingleFix();
    }

    /** The cadence in force right now: shorter while you are actually moving. */
    private long currentIntervalMs() {
        if (!moving) return intervalMs;
        return Math.max(MIN_MOVING_INTERVAL_MS, Math.min(intervalMs, intervalMs / 3));
    }

    /**
     * Listens on the passive provider for as long as tracking runs. It never
     * turns a radio on by itself: it only receives positions some other app
     * already asked for, so it is free and it fills the gaps between our own
     * checks (navigation running in the car being the obvious case).
     */
    private void startPassive() {
        if (passiveListener != null || locationManager == null) return;
        if (!locationManager.getAllProviders().contains(LocationManager.PASSIVE_PROVIDER)) return;
        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                onPassiveFix(location);
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
        try {
            locationManager.requestLocationUpdates(
                    LocationManager.PASSIVE_PROVIDER,
                    PASSIVE_MIN_TIME_MS,
                    PASSIVE_MIN_DISTANCE_M,
                    listener,
                    Looper.getMainLooper());
            passiveListener = listener;
        } catch (SecurityException | IllegalArgumentException ignored) {
        }
    }

    private void stopPassive() {
        if (passiveListener == null || locationManager == null) return;
        try {
            locationManager.removeUpdates(passiveListener);
        } catch (SecurityException ignored) {
        }
        passiveListener = null;
    }

    /** A free fix from another app. Kept only when it genuinely adds something. */
    private void onPassiveFix(Location location) {
        if (paused) return;
        if (location.hasAccuracy() && location.getAccuracy() > 120f) return;
        long since = System.currentTimeMillis() - lastFixAt;
        if (lastFix != null) {
            if (since < PASSIVE_MIN_TIME_MS) return;
            if (location.distanceTo(lastFix) < PASSIVE_MIN_DISTANCE_M) return;
        }
        recordFix(location);
    }

    /**
     * Turns the GNSS engine on for one position. The listener unregisters as
     * soon as a fix is accurate enough, and a timeout closes the window even if
     * nothing usable ever arrives — so the radio is never left on.
     */
    private void requestSingleFix() {
        if (locationManager == null) {
            finishTick(null);
            return;
        }

        final Location[] best = new Location[1];
        final LocationListener[] holder = new LocationListener[1];

        holder[0] = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                if (isBetter(location, best[0])) best[0] = location;
                if (location.hasAccuracy() && location.getAccuracy() <= GOOD_ACCURACY_M) {
                    stopListening(holder[0]);
                    finishTick(best[0]);
                }
            }

            @Override
            public void onProviderDisabled(@NonNull String provider) {
            }

            @Override
            public void onProviderEnabled(@NonNull String provider) {
            }

            /** Required on API < 29 or the listener is never registered on some ROMs. */
            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
            }
        };

        activeListener = holder[0];
        List<String> providers = locationManager.getAllProviders();
        boolean any = false;
        for (String provider : new String[] {
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
        }) {
            if (!providers.contains(provider)) continue;
            try {
                // minTime/minDistance 0: we want the first fix, and we take the
                // listener down ourselves the moment we have it.
                locationManager.requestLocationUpdates(
                        provider, 0L, 0f, holder[0], Looper.getMainLooper());
                any = true;
            } catch (SecurityException e) {
                stopListening(holder[0]);
                notifyStatus("permission", "Locatietoestemming ontbreekt");
                finishTick(null);
                return;
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "provider unavailable: " + provider);
            }
        }

        if (!any) {
            activeListener = null;
            notifyStatus("error", "Geen locatieprovider beschikbaar");
            finishTick(null);
            return;
        }

        // Timeout: take the best fix seen so far, or fall back to last-known,
        // rather than letting the radio run on for a sharper one.
        fixTimeout = () -> {
            if (activeListener == null) return;
            stopListening(activeListener);
            finishTick(best[0] != null ? best[0] : recentLastKnown());
        };
        long wait = Math.max(MIN_FIX_WAIT_MS, Math.min(MAX_FIX_WAIT_MS, currentIntervalMs() / 3));
        handler.postDelayed(fixTimeout, wait);
    }

    @Nullable
    private LocationListener activeListener = null;
    @Nullable
    private Runnable fixTimeout = null;

    private void stopListening(LocationListener listener) {
        if (fixTimeout != null) handler.removeCallbacks(fixTimeout);
        fixTimeout = null;
        activeListener = null;
        if (locationManager == null) return;
        try {
            locationManager.removeUpdates(listener);
        } catch (SecurityException ignored) {
        }
    }

    private void abortFix() {
        LocationListener listener = activeListener;
        if (listener != null) stopListening(listener);
        fixInFlight = false;
        releaseWakeLock();
    }

    /** Closes one tick: queue the fix, tell the app, arm the next tick. Callbacks
     *  already queued when the listener came down land here too, hence the guard
     *  — one tick may only ever produce one fix. */
    private void finishTick(@Nullable Location location) {
        if (!fixInFlight) return;
        fixInFlight = false;

        if (location == null) {
            location = recentLastKnown();
        }
        if (location != null) {
            recordFix(location);
        } else {
            notifyStatus("nofix", "Geen positie gevonden");
        }

        scheduleNext();
        updateNotification();
        releaseWakeLock();
    }

    /** Stores one accepted position and updates the travelling/standing state. */
    private void recordFix(Location location) {
        if (lastFix != null) {
            moving = location.distanceTo(lastFix) >= MOVING_M;
        }
        lastFix = location;
        lastFixAt = System.currentTimeMillis();
        enqueue(location);
        Sink current = sink;
        if (current != null) current.onLocation();
    }

    /** Best last-known position, but only if it can still describe where you are. */
    @Nullable
    private Location recentLastKnown() {
        if (locationManager == null) return null;
        Location best = null;
        for (String provider : new String[] {
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER,
        }) {
            try {
                if (!locationManager.getAllProviders().contains(provider)) continue;
                Location known = locationManager.getLastKnownLocation(provider);
                if (known == null) continue;
                if (best == null || known.getTime() > best.getTime()) best = known;
            } catch (SecurityException e) {
                return null;
            }
        }
        if (best == null) return null;
        long age = System.currentTimeMillis() - best.getTime();
        return age <= Math.max(intervalMs, 10 * 60_000L) ? best : null;
    }

    private static boolean isBetter(Location candidate, @Nullable Location current) {
        if (current == null) return true;
        if (!candidate.hasAccuracy()) return false;
        if (!current.hasAccuracy()) return true;
        return candidate.getAccuracy() < current.getAccuracy();
    }

    // --- Scheduling ---------------------------------------------------------

    private PendingIntent tickIntent() {
        Intent intent = new Intent(this, MmsLocationService.class).setAction(ACTION_TICK);
        return PendingIntent.getService(
                this, 2, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void scheduleNext() {
        scheduleAt(System.currentTimeMillis() + currentIntervalMs());
    }

    private void scheduleAt(long triggerAt) {
        if (paused) return;
        cancelSchedule();
        // Never sooner than a few seconds from now, whatever the caller asked.
        nextTickAt = Math.max(triggerAt, System.currentTimeMillis() + 5_000L);
        long delay = nextTickAt - System.currentTimeMillis();
        // Handler: exact while the CPU is up. Alarm: survives Doze.
        handler.postDelayed(tickRunnable, delay);
        if (alarmManager == null) return;
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                alarmManager.set(AlarmManager.RTC_WAKEUP, nextTickAt, tickIntent());
            } else if (canScheduleExact()) {
                // Plain setAndAllowWhileIdle is rate-limited by Doze to roughly
                // one firing per 9 minutes, so a 2- or 5-minute interval quietly
                // became 9+ with the screen off. The exact variant is not.
                alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP, nextTickAt, tickIntent());
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextTickAt, tickIntent());
            }
        } catch (SecurityException e) {
            // Exact-alarm permission revoked while running — fall back.
            try {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextTickAt, tickIntent());
            } catch (Exception ignored) {
            }
        } catch (Exception e) {
            Log.w(TAG, "alarm scheduling failed: " + e.getMessage());
        }
    }

    private boolean canScheduleExact() {
        if (alarmManager == null) return false;
        // Below API 31 SCHEDULE_EXACT_ALARM is granted just by declaring it.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return alarmManager.canScheduleExactAlarms();
    }

    private void cancelSchedule() {
        handler.removeCallbacks(tickRunnable);
        if (alarmManager != null) {
            try {
                alarmManager.cancel(tickIntent());
            } catch (Exception ignored) {
            }
        }
    }

    // --- Fix queue ----------------------------------------------------------

    /** Appends a fix for the app to pick up. Survives a destroyed WebView. */
    private void enqueue(Location location) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        JSONArray queue = readQueue(prefs);
        JSONObject item = new JSONObject();
        try {
            item.put("latitude", location.getLatitude());
            item.put("longitude", location.getLongitude());
            if (location.hasAccuracy()) item.put("accuracy", location.getAccuracy());
            if (location.hasAltitude()) item.put("altitude", location.getAltitude());
            item.put("time", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());
        } catch (JSONException e) {
            return;
        }
        queue.put(item);
        while (queue.length() > MAX_PENDING) queue.remove(0);
        prefs.edit().putString(KEY_PENDING, queue.toString()).apply();
    }

    /** Hands over every queued fix and clears the queue — exactly-once delivery. */
    static JSONArray drainQueue(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        JSONArray queue = readQueue(prefs);
        if (queue.length() > 0) prefs.edit().remove(KEY_PENDING).apply();
        return queue;
    }

    private static JSONArray readQueue(SharedPreferences prefs) {
        String raw = prefs.getString(KEY_PENDING, null);
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    // --- Wake lock ----------------------------------------------------------

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power == null) return;
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "markmysteps:fix");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) {
            // Timeout as a safety net: a crashed tick can never drain the battery.
            wakeLock.acquire(MAX_FIX_WAIT_MS + 30_000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {
            }
        }
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

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(statusLine())
                .setStyle(new NotificationCompat.BigTextStyle().bigText(statusLine()))
                .setSmallIcon(R.drawable.ic_stat_track)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setSilent(true)
                .setShowWhen(false)
                .setContentIntent(pending)
                .addAction(0, paused ? "Hervatten" : "Pauzeren", togglePending)
                .build();
    }

    /** What the notification tells you: when the last check was, and when the
     *  next one is due. Without it there is no way to see the tracker is alive. */
    private String statusLine() {
        if (paused) return "Gepauzeerd";
        StringBuilder out = new StringBuilder();
        if (lastFix != null) {
            out.append("Laatste check ").append(clock(lastFixAt));
            if (lastFix.hasAccuracy()) {
                out.append(" · ±").append(Math.round(lastFix.getAccuracy())).append(" m");
            }
        } else {
            out.append(fixInFlight ? "Positie bepalen…" : "Nog geen positie");
        }
        if (nextTickAt > 0) out.append(" · volgende ").append(clock(nextTickAt));
        // Spelling out the cadence makes a wrong interval visible immediately
        // instead of having to work it out from two clock times.
        out.append("\nElke ").append(minutes(currentIntervalMs()));
        if (moving) out.append(" (onderweg)");
        else if (currentIntervalMs() != intervalMs) out.append(" van ").append(minutes(intervalMs));
        return out.toString();
    }

    private static String minutes(long ms) {
        long min = Math.round(ms / 60_000.0);
        if (min <= 1) return "minuut";
        return min + " min";
    }

    private static String clock(long at) {
        return android.text.format.DateFormat.format("HH:mm", at).toString();
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
                .putString(EXTRA_TITLE, title)
                .apply();
    }

    private void restoreConfig() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        intervalMs = Math.max(60_000L, prefs.getLong(EXTRA_INTERVAL, intervalMs));
        title = orDefault(prefs.getString(EXTRA_TITLE, null), title);
    }

    private static String orDefault(@Nullable String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
