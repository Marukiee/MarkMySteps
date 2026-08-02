package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
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
    private static final int NOTIFICATION_ID = 4711;
    private static final String WORK_NAME = "mms-notify-poll";

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

        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                getContext(), 0, open, PendingIntent.FLAG_IMMUTABLE);

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
