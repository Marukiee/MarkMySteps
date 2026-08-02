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
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * The quarter-hourly "anything new?".
 *
 * These phones have no Play Services and therefore no push service to deliver
 * anything to them, so the app wakes itself instead: WorkManager runs this
 * every fifteen minutes, it asks the server whether something is waiting, and
 * if so it posts the notification itself. Tapping it opens the app on the trip
 * the message is about.
 *
 * It runs outside the WebView and cannot reach the session, so it carries a
 * token of its own that can do nothing but ask this one question.
 */
public class MmsNotifyWorker extends Worker {

    static final String PREFS = "mms_notify";
    static final String KEY_BASE_URL = "baseUrl";
    static final String KEY_TOKEN = "token";
    /** The last notification we put on screen, so it is never posted twice. */
    static final String KEY_LAST_ID = "lastId";

    private static final String CHANNEL_ID = "mms_news";
    private static final int NOTIFICATION_ID = 4712;
    private static final int TIMEOUT_MS = 15000;

    public MmsNotifyWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String baseUrl = prefs.getString(KEY_BASE_URL, null);
        String token = prefs.getString(KEY_TOKEN, null);
        if (baseUrl == null || token == null) {
            // Switched off between runs; nothing to do and nothing to retry.
            return Result.success();
        }

        JSONObject answer;
        try {
            answer = ask(baseUrl, token);
        } catch (Exception e) {
            // Offline, server asleep, tunnel down — try again next round rather
            // than burning a retry immediately.
            return Result.success();
        }
        if (answer == null) return Result.success();

        JSONObject latest = answer.optJSONObject("latest");
        if (latest == null || latest.isNull("id")) return Result.success();

        String id = latest.optString("id", "");
        if (id.isEmpty() || id.equals(prefs.getString(KEY_LAST_ID, null))) return Result.success();

        post(latest.optString("title", "MarkMySteps"), latest.optString("body", ""),
                latest.isNull("tripId") ? null : latest.optString("tripId", null));
        prefs.edit().putString(KEY_LAST_ID, id).apply();
        return Result.success();
    }

    /** GET {base}/notifications/poll?token=… — the only call this worker makes. */
    private JSONObject ask(String baseUrl, String token) throws Exception {
        String url = baseUrl + "/notifications/poll?token=" + URLEncoder.encode(token, "UTF-8");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestProperty("Accept", "application/json");
            if (conn.getResponseCode() != 200) return null;
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader =
                         new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            return new JSONObject(body.toString());
        } finally {
            conn.disconnect();
        }
    }

    private void post(String title, String body, String tripId) {
        Context context = getApplicationContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Meldingen", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Verzoeken en uitnodigingen van reisgenoten");
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // Read back by MainActivity, which hands it to the web app so the tap
        // lands on the trip the message is about rather than the home page.
        open.putExtra("mmsPath", tripId != null ? "/trips/" + tripId : "/friends");
        open.setData(Uri.parse("mms://notify/" + (tripId != null ? tripId : "list")));
        PendingIntent pending = PendingIntent.getActivity(
                context, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(R.drawable.ic_stat_track)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build();
        manager.notify(NOTIFICATION_ID, notification);
    }
}
