package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One-off notifications from the app itself.
 *
 * There is no push service here on purpose (no Play Services on the target
 * phones), so nothing arrives while the app is not running. This is for the
 * moment the app DOES notice something — an account being approved, say — and
 * wants to say so even if you have switched away.
 */
@CapacitorPlugin(name = "MmsNotify")
public class MmsNotifyPlugin extends Plugin {

    private static final String CHANNEL_ID = "mms_account";
    private static final int NOTIFICATION_ID = 4711;

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
