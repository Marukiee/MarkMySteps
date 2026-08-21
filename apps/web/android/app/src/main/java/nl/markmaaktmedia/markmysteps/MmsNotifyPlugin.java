package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.concurrent.TimeUnit;

/**
 * Notifications from the app itself.
 *
 * There is no push service here (no Play Services on the target phones), so
 * nothing is ever delivered TO the app. Two things happen instead: `show`
 * posts something the app has just noticed while it is running, and
 * `enableBackground` schedules a worker that wakes every quarter of an hour
 * and asks the server whether anything is waiting. See MmsNotifyWorker.
 */
@CapacitorPlugin(
        name = "MmsNotify",
        permissions = {
            @Permission(alias = "notify", strings = { Manifest.permission.POST_NOTIFICATIONS })
        })
public class MmsNotifyPlugin extends Plugin {

    private static final String CHANNEL_ID = "mms_account";
    /** Quiet channel: a progress bar that buzzes every percent is a nuisance. */
    private static final String TASK_CHANNEL_ID = "mms_tasks";
    private static final int NOTIFICATION_ID = 4711;
    private static final int TASK_NOTIFICATION_ID = 4712;
    /** Broadcast the job notification's own "Annuleren" button sends. */
    private static final String ACTION_CANCEL = "nl.markmaaktmedia.markmysteps.CANCEL_TASK";

    /**
     * Whether the cancel button has been pressed since anybody last asked.
     *
     * The work itself runs in the web view, so this is only a flag: the job
     * checks it as it goes and stops itself. Read once and cleared, because a
     * cancellation belongs to the job that was running when it was pressed.
     */
    private volatile boolean cancelRequested = false;
    private BroadcastReceiver cancelReceiver;
    private static final String WORK_NAME = "mms-notify-poll";

    @Override
    public void load() {
        cancelReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                cancelRequested = true;
                NotificationManager manager = notifications();
                if (manager != null) manager.cancel(TASK_NOTIFICATION_ID);
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_CANCEL);
        // Registered at runtime rather than in the manifest: it is only of use
        // while the app is running, which is also the only time a job is.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(cancelReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(cancelReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (cancelReceiver != null) {
            try {
                getContext().unregisterReceiver(cancelReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already gone; nothing to take down.
            }
            cancelReceiver = null;
        }
    }

    /** Whether the notification's cancel button was pressed. Clears on read. */
    @PluginMethod
    public void takeCancel(PluginCall call) {
        JSObject result = new JSObject();
        result.put("cancelled", cancelRequested);
        cancelRequested = false;
        call.resolve(result);
    }

    /**
     * Turns the background check on and remembers what it needs.
     *
     * Fifteen minutes is WorkManager's floor for periodic work; asked for
     * anything less it silently rounds up, so the interval is stated honestly.
     */
    @PluginMethod
    public void enableBackground(PluginCall call) {
        String baseUrl = call.getString("baseUrl");
        String token = call.getString("token");
        if (baseUrl == null || token == null) {
            call.reject("baseUrl and token are required");
            return;
        }
        // Trailing slashes would give the worker a double slash in its URL.
        while (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length() - 1);

        SharedPreferences prefs = getContext()
                .getSharedPreferences(MmsNotifyWorker.PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(MmsNotifyWorker.KEY_BASE_URL, baseUrl)
                .putString(MmsNotifyWorker.KEY_TOKEN, token)
                .apply();

        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(
                        MmsNotifyWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build())
                .build();
        // KEEP, not REPLACE: replacing on every app start would reset the
        // interval each time and the check would never actually run.
        WorkManager.getInstance(getContext())
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, work);
        call.resolve();
    }

    /** Stops the check and forgets the token; the server row is dropped by the app. */
    @PluginMethod
    public void disableBackground(PluginCall call) {
        WorkManager.getInstance(getContext()).cancelUniqueWork(WORK_NAME);
        getContext().getSharedPreferences(MmsNotifyWorker.PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(MmsNotifyWorker.KEY_BASE_URL)
                .remove(MmsNotifyWorker.KEY_TOKEN)
                .remove(MmsNotifyWorker.KEY_LAST_ID)
                .apply();
        call.resolve();
    }

    /**
     * Where a tapped notification wants the app to go, once and once only.
     *
     * Handed over on request rather than pushed into the WebView: the activity
     * is started before the web app exists, so anything evaluated there would
     * land in a page that is about to be replaced.
     */
    @PluginMethod
    public void takePendingPath(PluginCall call) {
        JSObject result = new JSObject();
        result.put("path", MainActivity.takePendingPath());
        call.resolve(result);
    }

    /** Whether Android will let us post anything at all. */
    @PluginMethod
    public void permission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", allowed());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || allowed()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("notify", call, "permissionCallback");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", allowed());
        call.resolve(result);
    }

    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(
                        getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * A job the app is busy with, as a notification that updates itself.
     *
     * Making a photo book of ninety pages takes a while, and staring at a
     * progress bar is not what anyone wants to do with that time. The work
     * carries on in the app; this says how far it has got from the shade, and
     * says so quietly - one notification, updated in place, on a channel with
     * no sound of its own.
     */
    @PluginMethod
    public void progress(PluginCall call) {
        String title = call.getString("title", "MarkMySteps");
        String body = call.getString("body", "");
        Integer percent = call.getInt("percent");
        boolean done = Boolean.TRUE.equals(call.getBoolean("done", false));
        // The first post of a job clears whatever the previous one left behind.
        if (percent != null && percent == 0 && !done) cancelRequested = false;

        NotificationManager manager = notifications();
        if (manager == null || !allowed()) {
            call.resolve();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && manager.getNotificationChannel(TASK_CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    TASK_CHANNEL_ID, "Bezig", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Voortgang van iets dat de app aan het maken is");
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                        getContext(), TASK_CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(R.drawable.ic_stat_track)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                // Only the first post makes a sound; every update after it is
                // the same notification changing its mind.
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp());

        if (!done) {
            // A job you have changed your mind about should be stoppable from
            // where you can see it, without opening the app to find a button.
            Intent cancel = new Intent(ACTION_CANCEL).setPackage(getContext().getPackageName());
            PendingIntent pending = PendingIntent.getBroadcast(
                    getContext(), 0, cancel,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(0, "Annuleren", pending);
        }

        if (done) {
            // Finished: it may be swiped away, and tapping it opens the app.
            builder.setOngoing(false).setAutoCancel(true);
        } else {
            builder.setOngoing(true)
                    .setProgress(100, percent == null ? 0 : Math.max(0, Math.min(100, percent)),
                            percent == null);
        }

        manager.notify(TASK_NOTIFICATION_ID, builder.build());
        call.resolve();
    }

    /** Takes the job notification away — the job was cancelled or is stale. */
    @PluginMethod
    public void clearProgress(PluginCall call) {
        NotificationManager manager = notifications();
        if (manager != null) manager.cancel(TASK_NOTIFICATION_ID);
        call.resolve();
    }

    private NotificationManager notifications() {
        return getContext().getSystemService(NotificationManager.class);
    }

    private PendingIntent openApp() {
        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(getContext(), 0, open, PendingIntent.FLAG_IMMUTABLE);
    }

    @PluginMethod
    public void show(PluginCall call) {
        String title = call.getString("title", "MarkMySteps");
        String body = call.getString("body", "");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(
                        getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            // Refused notifications: the app still shows the news on screen.
            call.resolve();
            return;
        }

        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null) {
            call.resolve();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Account", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Bericht over je account");
            manager.createNotificationChannel(channel);
        }

        PendingIntent pending = openApp();

        Notification notification = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(R.drawable.ic_stat_track)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build();
        manager.notify(NOTIFICATION_ID, notification);
        call.resolve();
    }
}
